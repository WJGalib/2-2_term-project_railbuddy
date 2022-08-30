const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 80;
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const otpGenerator = require('otp-generator');
const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

app.use(bodyParser.json());
app.use(cookieParser());

app.enable('trust proxy');
// app.use(cors());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

console.log(process.env.SESSION_SECRET);

const getSHA256 = (input) => {
    return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
};

const getSHA512 = (input) => {
    return crypto.createHash('sha512').update(JSON.stringify(input)).digest('hex');
};

const getMD5 = (input) => {
    return crypto.createHash('md5').update(JSON.stringify(input)).digest('hex');
};

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    sameSite: 'none',
    cookie: {
        // path: ['/api/login', '/api/getProfile'],
        maxAge: 30*60*1000,
        httpOnly: false
    }
}));



const { Pool, Client } = require('pg')

const dbclient = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
});

dbclient.connect();

app.post('/api/login', (req, res) => {
    console.log(req.body);

    dbclient.query(
        `SELECT name FROM customer WHERE mobile=$1 AND password=$2`,
        [req.body.mobile, req.body.password]
    ).then(qres => {
        //console.log(qres);
        if (qres.rows.length === 0) res.send({ 
            success: false,
            name: null
        });
        else {
            req.session.userid = req.body.mobile;
            res.send({
                success: true,
                name: qres.rows[0].name
            });
            console.log(req.session);
        };
    }).catch(e => console.error(e.stack));
});

app.post('/api/sendOTP', (req, res) => {
    let available = false;
    dbclient.query (
        `SELECT COUNT(*) FROM customer WHERE mobile=$1`,
        [req.body.mobile]
    ).then(qres => {
        if (qres.rows[0].count === '0') {
            dbclient.query (
                "CALL UPSERT_OTP($2, $1)",
                [otpGenerator.generate(6, {
                    upperCaseAlphabets: false,
                    lowerCaseAlphabets: false,
                    specialChars: false
                }), req.body.mobile]
            ).then(qres2 => {
                req.session.userid = req.body.mobile;
                res.send(true);
            }).catch(e => console.error(e.stack));
        } else res.send(false);
    }).catch(e => console.error(e.stack));
});

app.post('/api/checkOTP', (req, res) => {
    if (req.body.mobile == req.session.userid) {
        dbclient.query (
            `SELECT otp FROM otp WHERE mobile=$1`,
            [req.body.mobile]
        ).then (qres => {
            if (qres.rows[0].otp === req.body.otp) res.send(true);
            else res.send("Invalid OTP!");
        }).catch(e => console.error(e.stack));
    } else res.send ("Invalid session!");
});

app.post('/api/checkNID', (req, res) => {
    if (req.body.mobile == req.session.userid) {
        dbclient.query (
            `SELECT COUNT(*) FROM customer WHERE nid=$1`,
            [req.body.nid]
        ).then(qres => {
            if (qres.rows[0].count === '0') {
                axios.post("http://localhost:6969/api", {
                    nid: req.body.nid,
                    dob: req.body.dob
                }).then (res2 => {
                    console.log(res2.data);
                    if (res2.data === false) {
                        res.send (false)
                    } else res.send (res2.data); 
                }).catch (err => {
                    console.log(err);
                });
            } else res.send (true);
        }).catch(e => console.error(e.stack));
    } else res.redirect('/register');
});

app.post('/api/register', (req, res) => {
    if (req.body.mobile == req.session.userid) {
        console.log(req.body);
        dbclient.query (
            "INSERT INTO customer(mobile, password, nid, dob, name, address) values($1, $2, $3, $4, $5, $6)",
            [req.body.mobile, req.body.password, req.body.nid, req.body.dob, req.body.name, req.body.address]
        ).then(qres => {
            console.log(qres);
            if (qres.rowCount === 1) res.send(true);
            else if (qres.rowCount === 0) res.send(false);
        }).catch(e => {
            console.error(e.stack);
            res.send(false);
        });
    } else res.send(false);
});

app.post('/api/logout',(req,res) => {
    req.session.destroy();
    res.send({
        success: true
    });
});

app.post('/api/getProfile', (req, res) => {
    console.log(req.session);
    if (req.session.userid) {
        dbclient.query(
            "SELECT mobile, nid, dob, name, address, (pref).locale, (pref).pay_method, (pref).pay_acc FROM customer WHERE mobile=$1", 
            [req.session.userid]
        ).then(qres => {
            //console.log(qres);
            if (qres.rows.length === 0) res.send({ 
                success: false,
            });
            else {
                res.send({
                    ...qres.rows[0],
                    success: true,
                });
            };
        }).catch(e => console.error(e.stack));
    };
});

app.post('/api/getSelfID', (req, res) => {
    console.log(req.session);
    if (req.session.userid) {
        dbclient.query(
            "SELECT nid, name FROM customer WHERE mobile=$1", 
            [req.session.userid]
        ).then(qres => {
            //console.log(qres);
            if (qres.rows.length === 0) res.send({ 
                success: false,
            });
            else {
                res.send({
                    ...qres.rows[0],
                    success: true,
                });
            };
        }).catch(e => console.error(e.stack));
    };
});

app.post('/api/updateUser', (req,res) => {
    let attr = req.body.attr;
    if (req.session.userid === req.body.mobile) {
        if (attr==='address' || attr==='locale' || attr==='pay_method' || attr==='pay_acc') {
            if (attr != "address") attr = `pref.${attr}`; 
            dbclient.query(
                `UPDATE customer SET ${attr}=$1 WHERE mobile=$2`, 
                [req.body.value, req.body.mobile]
            ).then(qres => {
                //console.log(qres);
                if (qres.rowCount === 1) res.send({ 
                    success: true,
                });
                else if (qres.rowCount === 0) {
                    res.send({
                        success: false,
                    });
                };
            }).catch(e => console.error(e.stack));
        };
    };
});

app.post('/api/updatePassword', (req,res) => {
    dbclient.query(
        `UPDATE customer SET password=$1 WHERE mobile=$2 AND password=$3`, 
        [req.body.password, req.session.userid, req.body.password0]
    ).then(qres => {
        //console.log(qres);
        if (qres.rowCount === 1) res.send({ 
            success: true,
        });
        else if (qres.rowCount === 0) {
            res.send({
                success: false,
            });
        };
    }).catch(e => console.error(e.stack));
});

app.post('/api/getStations', (req,res) => {
    dbclient.query("SELECT id, name, district FROM station WHERE id < 900 ORDER BY district ASC, name ASC").then(qres => {
        res.send(qres.rows);
    }).catch(e => console.error(e.stack));
});

app.post('/api/getClasses', (req,res) => {
    dbclient.query("SELECT unnest(enum_range(NULL::seat_class));").then(qres => {
        let nameArr = [];
        qres.rows.forEach(obj => { nameArr.push(obj.unnest) });
        res.send(nameArr);
        console.log(nameArr);
    }).catch(e => console.error(e.stack));
});

app.post('/api/search', (req, res) => {
    if ((new Date(req.body.date)).toISOString().substring(0,10) == (new Date()).toISOString().substring(0,10)) {
        console.log ("searching trains after NOW");
        dbclient.query(`select *, get_station_name(origin) as oname, get_station_name(dest) as dname, 
                        next_journey_arrival(id, $1, $2, NOW()), next_departure(id, $1, NOW()), train_has_class(id, $3) as has_desired_class
                        from train 
                        where id in (select tr_id from connecting_trains($1, $2, NOW()))`,
                        [req.body.from, req.body.to, req.body.class]
        ).then(qres => {
            if (qres.rows.length === 0) res.send ( {success: false} );
            else res.send ( {success: true, trains: qres.rows});
        }).catch(e => console.error(e.stack));
    } else {
        console.log ("searching trains after" + req.body.date);
        dbclient.query(`select *, get_station_name(origin) as oname, get_station_name(dest) as dname, 
                        next_journey_arrival(id, $1, $2, $3::timestamp), next_departure(id, $1, $3::timestamp), train_has_class(id, $4)
                        as has_desired_class from train 
                        where id in (select tr_id from connecting_trains($1, $2, $3::timestamp))`,
                        [req.body.from, req.body.to, req.body.date, req.body.class]
        ).then(qres => {
            if (qres.rows.length === 0) res.send ( {success: false} );
            else res.send ( {success: true, trains: qres.rows});
        }).catch(e => console.error(e.stack));
    }
}); 

app.post('/api/getCoaches', (req, res) => {
    console.log (req.body);
    dbclient.query(`select distinct on (class_name) class_id, class_name, fare, get_capacity(class_id) as capacity, 
                    get_vacancy(class_id, $2) as vacancy from (select * from bogie order by fare desc) bogie where train_id=$1`,
    [req.body.id, req.body.date]
    ).then(qres => {
        dbclient.query(`SELECT station_id, station_name from route_detail ($1, $2, $3, $4::timestamp);`,
        [req.body.id, req.body.st1_id, req.body.st2_id, req.body.date]
        ).then(qres2 => {
            if (qres.rows.length === 0 || qres.rows.length === 0 ) res.send ( {success: false} );
            else res.send ( {success: true, route: qres2.rows, classes: qres.rows});
        }).catch(e => console.error(e.stack));
    }).catch(e => console.error(e.stack));
}); 

app.post('/api/checkSeats', (req, res) => {
    console.log (req.body);

    dbclient.query(`select seat_config.coach, mat_row, mat_col, mat, vacancy 
                    from seat_config join get_vacancy_matrices($1, $2) as occdate 
                    on seat_config.coach = occdate.coach 
                    where class_id=$1`,
    [req.body.class_id, req.body.date]
    ).then(qres => {
        if (qres.rows.length === 0) res.send ( {success: false} );
        else res.send ( {success: true, bogies: qres.rows});
    }).catch(e => console.error(e.stack));
}); 

app.post('/api/purchaseTicket', (req, res) => {
    const t_no = req.body.seatList.length;
    console.log(req.body, t_no);
    if (req.session.userid && t_no <= 4 && t_no >= 0) { 
        console.log("Initiating purchase...");
        let p_ids=Array(t_no), p_names=Array(t_no), L=Array(t_no), r=Array(t_no), c=Array(t_no);
        for (let i=0; i<t_no; i++) {
            p_ids[i] = req.body.seatList[i].pid, p_names[i] = req.body.seatList[i].pname, L[i] = req.body.seatList[i].L;
            r[i] = req.body.seatList[i].r + 1, c[i] = req.body.seatList[i].c + 1;
        };
        console.log('hello');
        dbclient.query(`call purchase_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '9O8T69F690R')`, [   
            req.session.userid, p_ids, p_names, req.body.class_id, L, 
            req.body.date, r, c, req.body.bStation,t_no,
        ]).then(qres => {
            console.log(qres);
            console.log("Purchase completed!");
        }).catch(e => console.error(e));
    };

})

app.post('/api/getPurchases', (req, res) => {
    console.log(req.session);
    if (req.session.userid) {
        dbclient.query(
            `select (select distinct get_train_name(train_id) from bogie as B where B.class_id=P.class_id) as train_name,
            (select distinct class_name from bogie as B where B.class_id=P.class_id) as class_name, *
            from purchases as P where mobile=$1`, [req.session.userid]
        ).then(qres => {
            //console.log(qres);
            if (qres.rows.length === 0) res.send({ 
                success: false,
            });
            else {
                res.send({
                    history: [...qres.rows],
                    success: true,
                });
            };
        }).catch(e => console.error(e.stack));
    };
});

app.post('/api/getPurchaseDetails', (req, res) => {
    console.log(req.session);
    if (req.session.userid) {
        dbclient.query(
            `select ticket_id, name, person_id, 
            (coach_letter || '-' || (select mat[seat_row_i][seat_row_col] 
                                     from seat_config 
                                     where class_id=substring(purchase_id::varchar, 1, 8)::int AND coach=coach_letter)) 
                                     as seat
            from tickets where purchase_id = $1`, [req.body.purchase_id]
        ).then(qres => {
            //console.log(qres);
            if (qres.rows.length === 0) res.send({ 
                success: false,
            });
            else {
                res.send({
                    tickets: [...qres.rows],
                    success: true,
                });
            };
        }).catch(e => console.error(e.stack));
    };
});

app.post('/api/getRoute', (req, res) => {
    console.log (req.body);
    if ((new Date(req.body.date)).toISOString().substring(0,10) == (new Date()).toISOString().substring(0,10)) {
        dbclient.query(`SELECT * from route_detail ($1, $2, $3, NOW());`,
        [req.body.train_id, req.body.st1_id, req.body.st2_id]
        ).then(qres => {
            if (qres.rows.length === 0) res.send ( {success: false} );
            else res.send ( {success: true, route: qres.rows});
        }).catch(e => console.error(e.stack));
    } else {
        dbclient.query(`SELECT * from route_detail ($1, $2, $3, $4::timestamp);`,
        [req.body.train_id, req.body.st1_id, req.body.st2_id, req.body.date]
        ).then(qres => {
            if (qres.rows.length === 0) res.send ( {success: false} );
            else res.send ( {success: true, route: qres.rows});
        }).catch(e => console.error(e.stack));
    }
}); 

app.post('/api/getComplaints', (req, res) => {
    console.log (req.body);
    console.log('ehfrgeighiuhvhe');
        dbclient.query(`SELECT * from complaint join customer on complaint.user_mobile = customer.mobile;`,
        ).then(qres => {
            if (qres.rows.length === 0){
                res.send ( {success: false} );
            }
            else res.send ( {
                success: true, 
                route: qres.rows
                
            });
        }).catch(e => console.error(e.stack));
});

app.post('/api/sendReply', (req, res) => {
    console.log (req.body);
    console.log('ehfrgeighiuhvhe');
        dbclient.query(`UPDATE complaint SET res_text = $1, res_time = current_timestamp WHERE id = $2`,
        [req.body.reply, req.body.id]
        ).then(qres => {
            if (qres.rowCount === 1) res.send({ 
                success: true,
            });
            else if (qres.rowCount === 0) {
                res.send({
                    success: false,
                });
            };
        }).catch(e => console.error(e.stack));
});

app.post('/api/validateSendNewMobileOTP', (req, res) => {
    if (req.session.userid) {
        console.log(req.body);
        dbclient.query(
            `SELECT COUNT(*) FROM customer WHERE mobile=$1 AND password=$2`,
            [req.session.userid, req.body.password]
        ).then(qres => {
            //console.log(qres);
            if (qres.rows[0].count == '0') res.send({ 
                success: false,
            });
            else {
                req.session.pwdChangeValidity = getSHA256(req.session.userid + process.env.CHANGE_SECRET);
                res.send({
                    success: true,
                });
                console.log(req.session);
            };
        }).catch(e => console.error(e.stack));
    } else {
        req.session.destroy();
        res.send({ 
            success: false,
        });
    };
});

app.post('/api/sendNewMobileOTP', (req, res) => {
    if (req.session.userid && req.session.pwdChangeValidity == getSHA256(req.session.userid + process.env.CHANGE_SECRET)) {
        dbclient.query (
            "CALL UPSERT_OTP($2, $1); ",
            [otpGenerator.generate(6, {
                upperCaseAlphabets: false,
                lowerCaseAlphabets: false,
                specialChars: false
            }), req.body.newMobile]
        ).then(qres2 => {
            console.log(qres2);
            res.send({
                success: true,
            });
        }).catch(e => console.error(e.stack));
    } else {
        req.session.destroy();
        res.send({ 
            success: false,
        });
    };
});


app.post('/api/changePassword', (req, res) => {
    if (req.session.userid && req.session.pwdChangeValidity == getSHA256(req.session.userid + process.env.CHANGE_SECRET)) {
        console.log(req.body);
        dbclient.query (
            "UPDATE customer SET mobile=$1 where mobile=$2 AND password=$3 AND (SELECT otp FROM otp WHERE mobile=$1) = $4",
            [req.body.newMobile, req.session.userid, req.body.password, req.body.otp]
        ).then(qres => {
            console.log(qres);
            if (qres.rowCount === 1) res.send({ 
                success: true,
            });
            else if (qres.rowCount === 0) res.send({ 
                success: false,
            });
        }).catch(e => {
            console.error(e.stack);
            res.send({ 
                success: false,
            });
        });
    } else {
        req.session.destroy();
        res.send({ 
            success: false,
        });
    };
});

app.use(express.static(path.resolve(__dirname, '../railbuddy-client/dist')));

app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../railbuddy-client/dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`RailBuddy backend listening on port ${port}`);
});