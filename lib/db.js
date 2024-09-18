class db {
    mysql = require('mysql2/promise');
    cfg = require('../env.js').database;
    //
    connect() {
        return new Promise(async (resolve, reject) => {
            this.pool = this.mysql.createPool({
                host: this.cfg.host,
                port: this.cfg.port,
                user: this.cfg.user,
                password: this.cfg.pass,
                database: this.cfg.db,
                socketPath: this.cfg.socket,
                multipleStatements: true,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                timezone: 'Z',
                supportBigNumbers: true,
                bigNumberStrings: true
            });
            await this.pool.query(`USE ${this.cfg.db};`)
                .catch((e) => {
                    console.log('[MySQL] Error: ' + e.errno + ": " + e.message);
                    return reject(false);
                });
            //
            resolve(true);
        });
    }
    // ** Accounts (bots)
    async addAccount(name, login, pass, shared, identity, iv, enabled) {
        if (typeof (this.pool === 'undefined') || this.pool === null) await this.connect();
        //
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.bots} (name, login, pass, shared, identity, iv, enabled) VALUES (?, ?, ?, ?, ?, ?, ?);`, [name, login, pass, shared, identity, iv, enabled])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    getAccount(name) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT * FROM ${this.cfg.table.bots} WHERE name = ?;`, [name])
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    getAccounts() {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT * FROM ${this.cfg.table.bots} WHERE enabled = '1';`)
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    setAccountSID(id, sid) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`UPDATE ${this.cfg.table.bots} SET sid = ? WHERE id = ?;`, [sid, id])
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
}

module.exports = db;