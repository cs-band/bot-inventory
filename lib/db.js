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

    // ** User
    userSteamGet(usid) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT us.*, u.name FROM ${this.cfg.table.usteam} as us INNER JOIN ${this.cfg.table.users} as u ON us.uid = u.id WHERE us.id = ?;`, [usid])
                .then(([rows, fields]) => {
                    if (typeof (rows) === 'undefined') return null;
                    if (rows === null) return null;
                    if (rows.length < 0) return null;
                    //
                    return resolve(rows[0]);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    // ** Queue
    queueGetTypes() {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT * FROM ${this.cfg.table.queue_type}`)
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    queueAdd(type, params) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.queue} (type, params) VALUES (?, ?)`, [type, JSON.stringify(params)])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    queueGetAll() {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT * FROM ${this.cfg.table.queue} WHERE response is NULL`)
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    queueAddResponse(id, response) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`UPDATE ${this.cfg.table.queue} SET response = ? WHERE id = ?;`, [JSON.stringify(response), id])
                .then((m) => {
                    return resolve(m);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    // * Items info
    itemInsertCategory(category, category_name) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.item_category} (category, category_name) VALUES (?, ?);`, [category, category_name])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    console.log(e);
                    return reject(e);
                });
        });
    }
    itemInsertTag(category_id, name, internal_name) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.item_tags} (category_id, name, internal_name) VALUES (?, ?, ?);`, [category_id, name, internal_name])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    itemGetCategory() {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`SELECT id, category FROM ${this.cfg.table.item_category};`)
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    itemGetTags() {
        return new Promise(async (resolve, reject) => {
            // SELECT it.id, it.category_id, ic.category, it.internal_name FROM ${this.cfg.table.item_tags} it INNER JOIN ${this.cfg.table.item_category} ic ON it.category_id = ic.id;
            await this.pool.query(`SELECT id, category_id, internal_name FROM ${this.cfg.table.item_tags}`)
                .then(([rows, fields]) => {
                    return resolve(rows);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    itemInsertVariant(name, name_hash) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.item_variants} (name, name_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id);`, [name, name_hash])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }
    itemInsertToTag(item_variant_id, tag_id) {
        return new Promise(async (resolve, reject) => {
            await this.pool.query(`INSERT INTO ${this.cfg.table.item_to_tag} (item_variant_id, tag_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id);`, [item_variant_id, tag_id])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

    inventoryInsert(usid, inventory) {
        return new Promise(async (resolve, reject) => {
            inventory = JSON.stringify(inventory);
            //
            await this.pool.query(`INSERT INTO ${this.cfg.table.us_inventory} (usid, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?`, [usid, inventory, inventory])
                .then((m) => {
                    return resolve(m[0].insertId);
                }).catch((e) => {
                    console.log(e.errno + ": " + e.sqlMessage);
                    return reject(e);
                });
        });
    }

}

module.exports = db;