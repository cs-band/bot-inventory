const crypto = require('crypto'),
    express = require('express'),
    server = express(),
    port = 8192;

class Base {
    constructor() {
        this.args = process.argv.splice(2);
        this.cfg = require('./env').infobot;
        this.db = new (require('./lib/db'))();
        this.DateTime = require("luxon").DateTime;
        this.botController = new (require('./lib/bot/botController'))(this);
        this.start();
    }

    async start() {
        if (this.argExist("test")) {
            this.log(`text`, "sdsa", "gfgfg");
            //
            process.exit(1);
        }
        //
        await this.db.connect().then(console.log("[DB] Connected")).catch(e => {
            console.log(e);
            process.exit(1);
        });
        //
        await this.botController.start();
        //
        let accounts = await this.db.getAccounts()
            .then(e => {
                return e;
            })
            .catch(e => {
                this.log(`Can't get account's from db`, `START`);
                console.log(e);
                process.exit(1);

            });
        //
        if (!this.argExist("noserve")) {
            this.expressHandle();
        }
        //
        if (!this.argExist("noacc")) {
            //
            if (!Array.isArray(accounts)) this.log(`Account isn't array`, `START`);
            if (accounts.length < 1) this.log(`No accounts`, `START`);
            for (let acc of accounts) {
                let account = this.decryptAccount(acc.login, acc.pass, acc.shared, acc.identity, acc.iv);
                //
                this.botController.add({
                    id: parseInt(acc.id),
                    name: acc.name,
                    sid: acc.sid,
                    user: account.login,
                    pass: account.pass,
                    shared: account.shared,
                    identity: account.identity
                });
                //
                await this.sleep(1000);
            }
        }
    }

    expressHandle() {
        server.use(express.json());

        // * Express
        server.listen(port, () => {
            console.log(`Start listening on port ${port}`);
        });

        server.get('/ti', async (req, res) => {
            let response = await this.botController.inventoryUser();
            return res.send(response);
        });

        server.post('/test', async (req, res) => {
            let uid = req.body.uid,
                usid = req.body.usid,
                items = req.body.items;// itemsids
            //
            let response = await this.botController.withdraw(uid, usid, items);
            return res.send(response);
        });

        server.post('/addAccount', async (req, res) => {
            let name = req.body.name,
                login = req.body.login,
                pass = req.body.pass,
                shared = req.body.shared,
                identity = req.body.identity,
                secret = req.body.secret;
            if (typeof name === 'undefined' || typeof login === 'undefined' || typeof pass === 'undefined' || typeof shared === 'undefined' || typeof identity === 'undefined' || typeof secret === 'undefined') {
                return res.send({
                    success: false
                });
            }
            //
            if (secret != this.cfg.secret) {
                return res.send({
                    success: false
                });
            }
            //
            let encryptedAccount = this.encryptAccount(login, pass, shared, identity);
            await this.db.addAccount(name, encryptedAccount.login, encryptedAccount.pass, encryptedAccount.shared, encryptedAccount.identity, encryptedAccount.iv, 1)
                .then(id => {
                    this.log(`Account added #${id}`,`${name}`);
                    this.botController.add({
                        id: parseInt(id),
                        name: name,
                        sid: null,
                        user: login,
                        pass: pass,
                        shared: shared,
                        identity: identity
                    });
                    //
                    return res.send({
                        success: true,
                        id: id
                    });
                })
                .catch(e => {
                    return res.send({
                        success: false,
                        err: e
                    });
                });
        });
    }

    encryptAccount(login, pass, shared, identity) {
        let iv = crypto.randomBytes(16).toString('hex').substring(0, 16);
        //
        return {
            login: this.encrypt(this.cfg.secret, iv, login),
            pass: this.encrypt(this.cfg.secret, iv, pass),
            shared: this.encrypt(this.cfg.secret, iv, shared),
            identity: this.encrypt(this.cfg.secret, iv, identity),
            iv: iv
        };
    }

    decryptAccount(login, pass, shared, identity, iv) {
        return {
            login: this.decrypt(this.cfg.secret, iv, login),
            pass: this.decrypt(this.cfg.secret, iv, pass),
            shared: this.decrypt(this.cfg.secret, iv, shared),
            identity: this.decrypt(this.cfg.secret, iv, identity),
        }
    }

    encrypt(secret, iv, data) {
        let key = crypto
            .createHash('sha512')
            .update(secret)
            .digest('hex')
            .substring(0, 32);
        let encryptedIV = crypto
            .createHash('sha512')
            .update(iv)
            .digest('hex')
            .substring(0, 16);
        let cipher = crypto.createCipheriv('aes-256-cbc', key, encryptedIV);
        //
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('hex');
    }

    decrypt(secret, iv, data) {
        let key = crypto
            .createHash('sha512')
            .update(secret)
            .digest('hex')
            .substring(0, 32);
        let encryptedIV = crypto
            .createHash('sha512')
            .update(iv)
            .digest('hex')
            .substring(0, 16);
        let decipher = crypto.createDecipheriv('aes-256-cbc', key, encryptedIV);
        //
        let decrypted = decipher.update(Buffer.from(data, 'hex'));
        return Buffer.concat([decrypted, decipher.final()]).toString('utf8');;
    }

    log(text, ...args) {
        // console.log(text);
        // console.log(args);
        console.log(`[${args.join("][")}] ${text}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    argExist(arg) {
        let a = this.args.find(x => x.replaceAll("-", "") == arg);
        if (typeof (a) === 'undefined') return false;
        return true;
    }
}

module.exports = new Base();