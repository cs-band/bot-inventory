const botClass = require('./bot'),
    fs = require('fs'),
    path = require('path'),
    //{ DateTime } = require("luxon"),
    vdf = require('vdf-parser'),
    https = require('https'),
    EventEmitter = require('events').EventEmitter;

class botController extends EventEmitter {
    bots = [];
    queueTypes = {};

    constructor(base) {
        super();
        //
        this.base = base;
        //
        this.items_game_url = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt';
        this.items_game_cdn_url = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game_cdn.txt';
        this.csgo_english_url = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/resource/csgo_english.txt';
        this.items_game = null;
        this.items_game_cdn = null;
        this.csgo_english = null;
        //
        this.path_gamedata = path.join(this.base.cfg.path.tmp, this.base.cfg.path.gamedata);
        this.path_pooldata = path.join(this.base.cfg.path.tmp, this.base.cfg.path.pooldata);
        //
        if (!fs.existsSync(this.path_gamedata)) fs.mkdirSync(this.path_gamedata, { recursive: true });
        if (!fs.existsSync(this.path_pooldata)) fs.mkdirSync(this.path_pooldata, { recursive: true });
    }

    async start() {
        this.log(`Started`);
        //
        // this.gameFilesUpdate();
        // if (this.base.cfg.time.gameFilesUpdate > 0) setInterval(() => { this.gameFilesUpdate(); }, this.base.cfg.time.gameFilesUpdate * 1000);
        //
        this.queueStart();
    }

    add(login) {
        let bot = new botClass(this);

        bot.on('ready', () => {
            this.log(`Bot is ready`, `${bot.login.name}`);
        });

        bot.on('unready', () => {
            this.log(`Bot isn't ready`, `${bot.login.name}`);
        });

        bot.on('loggedOn', (message) => {
            this.log(`${message}`, `${bot.login.name}`);
        });

        bot.signIn(login);

        this.bots.push(bot);
    }

    async inventoryUser() {
        let bot = this.botGetFree();
        if (bot === null) return { err: 'no free bots' };
        //
        let response = await bot.userInventoryFromTrade();
        return response;
    }

    // *** QUEUE
    async queueStart() {
        this.queueList = [];
        this.queueTypes = {};
        //
        await this.base.db.queueGetTypes().then((qt) => {
            for (let q of qt) {
                this.queueTypes[`${q.name}`] = q.id;
            }
        }).catch((e) => {
            // ! can't start
            this.log(`can't start botController`);
            process.exit(1);
        });
        //
        this.queueLoop();
    }
    async queueLoop() {
        while (true) {
            await this.sleep(1000);
            // * Cleanup
            await this.queueClear();
            await this.sleep(150);
            // * Get all queue from db without response
            if (!(await this.queueGet())) { await this.sleep(9000); continue; }
            await this.sleep(150);
            // * Send To bots
            await this.queueBotPush();
            await this.sleep(150);
        }
    }

    queueClear() {
        return new Promise(async (resolve) => {
            if (this.queueList.length > 0) {
                for (let i = this.queueList.length - 1; i >= 0; i--) {
                    if (typeof (this.queueList[i]) === 'undefined') continue;
                    if (this.queueList[i].done === false) continue;
                    //
                    await this.base.db.queueAddResponse(this.queueList[i].id, this.queueList[i].response).then((e) => {
                        this.log(`Response saved`, `queue#${this.queueList[i].id}`);
                        this.queueList.splice(i, 1);
                    }).catch((e) => {
                        this.log(`Response error: ${JSON.stringify(this.queueList[i].response)}`, `queue#${this.queueList[i].id}`);
                    });
                }
            }
            //
            return resolve(true);
        });
    }

    queueGet() {
        return new Promise(async (resolve) => {
            await this.base.db.queueGetAll()
                .then((queueList) => {
                    if (queueList.length < 1) return resolve(true);
                    //
                    for (let queue of queueList) {
                        let index = this.queueList.findIndex(x => x.id == queue.id);
                        if (index > -1) continue;
                        //
                        queue.inProgress = false;
                        queue.done = false;
                        //
                        this.log(`Added`, `queueGet`, `queue#${queue.id}`);
                        this.queueList.push(queue);
                    }
                    //
                    return resolve(true);
                })
                .catch((e) => {
                    //!! db queue err
                    this.log(`Error ${e.message}`, `queueGet`);
                    return resolve(false);
                });
        })
    }

    queueBotPush() {
        return new Promise((resolve) => {
            if (Object.entries(this.queueList).length < 1) return resolve(true);
            for (let queue of this.queueList) {
                if (queue.inProgress) continue;
                //
                let bot = this.botGetFree();
                if (bot === null) continue;
                //
                this.log(`in progress`, `queueBotPush`, `queue#${queue.id}`);
                queue.inProgress = true;
                bot.queueTask(queue);
            }
            //
            return resolve(true);
        });
    }

    botGetFree() {
        // Shuffle array to evenly distribute requests
        for (let bot of this.shuffleArray(this.bots)) {
            if (!bot.busy && bot.ready) return bot;
        }

        return null;
    }

    botGetById(id) {
        let i = this.bots.findIndex(x => x.login.id == id);
        if (i < 0) return null;
        return this.bots[i];
    }


    async gameFilesUpdate() {
        this.log(`Updating Game Files...`, `GameData`);

        await this.downloadFile(this.items_game_url)
            .then((data) => {
                this.items_game = vdf.parse(data)['items_game'];
                fs.writeFileSync(path.join(this.gamedata, this.base.cfg.path.files.items_game), data, 'utf8');
                this.log(`Updated`, `${this.base.cfg.path.files.items_game}`, `GameData`);
            })
            .catch((err) => {
                this.log(`Error: ${err}`, `${this.base.cfg.path.files.items_game}`, `GameData`);
            });

        await this.downloadFile(this.items_game_cdn_url)
            .then((data) => {
                this.items_game_cdn = this.parseItemsCDN(data);
                fs.writeFileSync(path.join(this.gamedata, this.base.cfg.path.files.items_game_cdn), data, 'utf8');
                this.log(`Updated`, `${this.base.cfg.path.files.items_game_cdn}`, `GameData`);
            })
            .catch((err) => {
                this.log(`Error: ${err}`, `${this.base.cfg.path.files.items_game_cdn}`, `GameData`);
            });

        await this.downloadFile(this.csgo_english_url)
            .then((data) => {
                this.csgo_english = this.objectKeysToLowerCase(vdf.parse(data)['lang']['Tokens']);
                this.csgo_english = new Proxy(this.csgo_english, this.LanguageHandler);

                fs.writeFileSync(path.join(this.gamedata, this.base.cfg.path.files.csgo_english), data, 'utf8');
                this.log(`Updated`, `${this.base.cfg.path.files.csgo_english}`, `GameData`);
            })
            .catch((err) => {
                this.log(`Error: ${err}`, `${this.base.cfg.path.files.csgo_english}`, `GameData`);
            });
    }

    downloadFile(url) {
        return new Promise((resolve, reject) => {
            https.get(url, function (res) {
                if (res.statusCode !== 200) return reject(res.statusCode);

                res.setEncoding('utf8');
                let data = '';

                res.on('error', function (err) {
                    return reject(err.message);
                });

                res.on('data', function (chunk) {
                    data += chunk;
                });

                res.on('end', function () {
                    return resolve(data);
                });
            });
        });
    }

    parseItemsCDN(data) {
        let lines = data.split('\n');

        const result = {};

        for (let line of lines) {
            let kv = line.split('=');

            if (kv[1]) {
                result[kv[0]] = kv[1];
            }
        }

        return result;
    }

    objectKeysToLowerCase(obj) {
        const keys = Object.keys(obj);
        let n = keys.length;
        while (n--) {
            const key = keys[n];
            const lower = key.toLowerCase();
            if (key !== lower) {
                obj[lower] = obj[key];
                delete obj[key];
            }
        }

        return obj;
    }

    LanguageHandler = {
        get: function (obj, prop) {
            return obj[prop.toLowerCase()];
        },
        has: function (obj, prop) {
            return prop.toLowerCase() in obj;
        }
    };

    log(text = "", ...args) {
        args.unshift("botController");
        this.base.log(text, ...args);
    }

    shuffleArray = function (arr) {
        return arr.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value)
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

}

module.exports = botController;