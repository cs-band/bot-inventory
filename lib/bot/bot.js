const SteamUser = require('steam-user'),
    SteamCommunity = require('steamcommunity'),
    SteamTotp = require('steam-totp'),
    SteamTradeManager = require('steam-tradeoffer-manager'),
    GlobalOffensive = require('globaloffensive'),
    { DateTime } = require("luxon"),
    fs = require('fs'),
    EventEmitter = require('events').EventEmitter;

class Bot extends EventEmitter {

    // *
    // *** Сonstructor
    // *

    constructor(controller) {
        super();
        //
        this.controller = controller;
        this.client = new SteamUser({
            enablePicsCache: true // Required to check if we own CSGO with ownsApp
        });
        this.community = new SteamCommunity();
        this.tradeManager = new SteamTradeManager({
            steam: this.client,
            useAccessToken: true,
            domain: "localhost", // Our domain is example.com
            language: "en", // We want English item descriptions
            pollInterval: 60000 // We want to poll every 10 seconds since we don't have Steam notifying us of offers
        });
        this.game = new GlobalOffensive(this.client);
        this.bindEventHandlers();
    }

    async queueTask(queue) {
        this.busy = true;
        let delay = 0;
        //
        let response = null;
        switch (queue.type) {
            case 1: // inventory
                response = await this.userInventoryFromTrade(queue.params)
                    .then(e => { return e; })
                    .catch(e => { return e; });
                break;
            case 2: // inspect (float, pattern)
                response = await this.userItemInspect(queue.params)
                    .then(e => e)
                    .catch(e => { return e; });
                break;
        }
        //
        if (response.delay) {
            delay = response.delay;
            response.delay = undefined;
        }
        //
        queue.response = response;
        queue.done = true;
        //
        if (delay > 0) {
            await this.sleep(delay);
        }
        //
        this.busy = false;
    }

    userItemInspect(params) {
        return new Promise(async (resolve, reject) => {
            if (typeof (params.usid) === 'undefined' || typeof (params.a) === 'undefined' || typeof (params.d) === 'undefined') return reject({ err: { message: "no param", id: -1 } });
            //
            let user = await this.controller.base.db.userSteamGet(params.usid).catch(e => { return null });
            if (user === null) return reject({ err: { message: "no user", id: -1 } });
            if (user.sid === null) return reject({ err: { message: "no steamid", id: -1 } });
            //
            let itemData = null;
            let received = false;
            let timeout = false;
            //
            let inspectItemTimedOutEvent = (assetid) => { if (params.a == assetid) timeout = true; };
            this.game.on("inspectItemTimedOut", inspectItemTimedOutEvent);
            //
            while (!this.game.haveGCSession) await this.sleep(50);
            let timeStarted = new Date().getTime();
            this.log(`${user.sid}, ${params.a}, ${params.d}`,`inspect`)
            this.game.inspectItem(user.sid, params.a, params.d, (data) => {
                itemData = data;
                received = true;
            });
            //
            while (!received && !timeout) await this.sleep(50);
            //
            this.game.removeListener("inspectItemTimedOut", inspectItemTimedOutEvent);
            //
            if (received) {
                let offset = new Date().getTime() - timeStarted;
                let delay = this.controller.base.cfg.inspectDelay - offset;
                if (delay < 0) delay = 0;
                //
                if (itemData === null || typeof (itemData) === 'undefined') return reject({ err: { message: "item null", id: -1 }, delay: delay });
                //
                //console.log(itemData);
                // for (let sticker of itemData.stickers) {
                //     sticker.stickerId = sticker.sticker_id;
                //     delete sticker.sticker_id;
                // }
                //
                // save float as biguint
                let buffer = Buffer.alloc(8);
                buffer.writeDoubleBE(itemData.paintwear, 0);
                itemData.paintwearInt = buffer.readBigUInt64BE(0);
                // create float from biguint (string)
                // let f = BigInt("4595667872935575552");
                // let bb = Buffer.alloc(8);
                // bb.writeBigUInt64BE(f, 0);
                // bb.readDoubleBE(0);
                //
                let stickers = itemData.stickers.length > 0 ? itemData.stickers.map((s) => {
                    let res = { s: s.slot, i: s.sticker_id };
                    if (s.wear) {
                        res.w = s.wear;
                    }
                    if (s.rotation) {
                        res.r = s.rotation;
                    }
                    if (s.offset_x) {
                        res.x = s.offset_x;
                    }
                    if (s.offset_y) {
                        res.y = s.offset_y;
                    }
                    return res;
                }) : null;

                if (stickers) {
                    // Add a property on stickers with duplicates that signifies how many dupes there are
                    // Only add this property to one of the dupe stickers in the array
                    for (let sticker of stickers) {
                        let matching = stickers.filter((s) => s.i === sticker.i);
                        if (matching.length > 1 && !matching.find((s) => s.d > 1)) {
                            sticker.d = matching.length;
                        }
                    }
                }

                itemData.stickers = stickers;
                //
                let db_insert = await this.controller.base.db.itemInspectInsert(params.usid, params.a, params.d, itemData, params.iv_id).catch((e) => { return e; });
                if (db_insert === null) return resolve({ err: { message: "can't add row in db", id: -1 }, delay: delay });
                return resolve({ insectID: db_insert, delay: delay })
            } else {
                return reject({ err: { message: "timeout", id: -1 } });
            }
        });
    }

    userInventoryFromTrade(params) {
        return new Promise(async (resolve, reject) => {
            if (typeof (params.usid) === 'undefined') return reject({ err: { message: "no param usid", id: -1 } });
            //
            let user = await this.controller.base.db.userSteamGet(params.usid);
            if (user === null) return resolve({ err: { message: "no user with this usid", id: -1 } });
            if (user.token === null) return resolve({ err: { message: "user doesn't have a token for trade", id: -1 } });
            //let offer = this.tradeManager.createOffer("76561198129661402", "2fz7HpZb"); 
            //let offer = this.tradeManager.createOffer("76561198142260853", "O_PWUGvW");
            while (!this.ready) await this.sleep(150);
            let offer = this.tradeManager.createOffer(user.sid, user.token);
            let them_inventory = null;
            let them_inventory_err = null;
            offer.getPartnerInventoryContents(730, 2, (err, inv, curr) => {
                if (err) {
                    them_inventory = [];
                    them_inventory_err = err;
                    return;
                }
                //
                them_inventory = inv;
            });
            while (them_inventory === null) await this.sleep(100);
            //
            if (them_inventory_err !== null) {
                return resolve({ err: { message: "can't get inventory", original: them_inventory_err.message, id: -1 } });
            }
            //
            await this.inventoryItemsScan(them_inventory).then(async (data) => {
                await this.controller.base.db.inventoryInsert(1, data)
                    .catch((e) => {
                        this.log('db error on inventoryInsert', 'userInventoryFromTrade');
                        return resolve({ err: { message: "can't insert inventory in db", id: -1 } });
                    });
            }).catch((e) => {
                return resolve({ err: { message: "can't done inventoryItemsScan", id: -1 } });
            });
            //
            return resolve({ success: true });
        });
    }

    // * Include inventory items in database
    inventoryItemsScan(inventory) {
        return new Promise(async (resolve, reject) => {
            if (inventory.length < 1) return resolve([]);
            let categoryCurrent = await this.controller.base.db.itemGetCategory().catch((e) => { return null });
            if (categoryCurrent === null) this.log('db error on itemGetCategory', 'inventoryItemsScan');
            let tagsCurrent = await this.controller.base.db.itemGetTags().catch((e) => { return null });
            if (tagsCurrent === null) this.log('db error on itemGetTags', 'inventoryItemsScan');
            //
            let inventory_user = [];
            for (let item of inventory) {
                let category_to_add = [];
                //
                let stickers = [];
                let stickersIndex = item["descriptions"].findLastIndex(x => (x.value.indexOf("sticker_info") > -1));
                if (stickersIndex > -1) {
                    category_to_add = ["Type", "Weapon", "ItemSet", "Quality", "Rarity", "Exterior"];
                    let stickers_html = this.controller.base.HTMLParser.parse(item["descriptions"][stickersIndex].value);

                    if (stickers_html.querySelector("center") !== null) {
                        stickers = stickers_html.querySelector("center").text.replaceAll("Sticker", "").replaceAll("Patch", "").replaceAll(":", "").trim().split(", ");
                    }
                }
                //
                let nametagIndex = item["descriptions"].findIndex(x => (x.value.indexOf("Name Tag") > -1));
                //
                let item_tags = [];
                //
                for (let tag of item["tags"]) {
                    if (category_to_add.length > 0) { if (category_to_add.findIndex(x => x == tag.category) < 0) continue; }
                    let categoryIndex = categoryCurrent.findIndex(x => x.category == tag.category);
                    if (categoryIndex < 0) {
                        console.log(`${tag.category} no in db`);
                        //
                        let cat_db_id = await this.controller.base.db.itemInsertCategory(tag.category, tag.category_name).catch((e) => { return null });
                        if (cat_db_id === null) { this.log('db error on itemInsertCategory', 'inventoryItemsScan'); continue; } // !
                        //
                        categoryIndex = categoryCurrent.push({ id: cat_db_id, category: tag.category }) - 1;
                        //
                        this.log(`cat#${tag.category} included in db, id#${cat_db_id}`, 'inventoryItemsScan');
                    }
                    //
                    let tagIndex = tagsCurrent.findIndex(x => x.category_id == categoryCurrent[categoryIndex].id && x.internal_name == tag.internal_name);
                    if (tagIndex < 0) {
                        console.log(`${tag.internal_name} no in db`);
                        //
                        let tag_db_id = await this.controller.base.db.itemInsertTag(categoryCurrent[categoryIndex].id, tag.name, tag.internal_name).catch((e) => { return null });
                        if (tag_db_id === null) { this.log('db error on itemInsertTag', 'inventoryItemsScan'); continue; } // !
                        //
                        tagIndex = tagsCurrent.push({ id: tag_db_id, category_id: categoryCurrent[categoryIndex].id, internal_name: tag.internal_name }) - 1;
                        //
                        this.log(`tag#${tag.internal_name} included in db, id#${tag_db_id}`, 'inventoryItemsScan');
                    }
                    //
                    item_tags.push(tagsCurrent[tagIndex].id);
                    //let item_to_tag_db_id = await this.controller.base.db.itemInsertToTag(item_variant_db_id, tagsCurrent[tagIndex].id).catch((e) => { return null });
                    //if (item_to_tag_db_id === null) { this.log('db error on itemInsertToTag', 'inventoryItemsScan'); continue; } // !
                }
                //
                let item_variant_db_id = await this.controller.base.db.itemInsertVariant(item["name"], item["market_hash_name"], item_tags).catch((e) => { return null });
                if (item_variant_db_id === null) { this.log('db error on itemInsertVariant', 'inventoryItemsScan'); continue; } // !
                //
                let item_args = this.getItemArgsInventory(item);
                //
                item_args["iv_id"] = item_variant_db_id;
                if (stickers.length > 0) item_args["stickers"] = stickers;
                if (nametagIndex > -1) item_args["nametag"] = /''(.+)''/.exec(item["descriptions"][nametagIndex].value)[1];
                if (item["name"].indexOf("StatTrak™") > -1) {
                    //
                    let stIndex = item["descriptions"].findIndex(x => (x.value.indexOf("Confirmed Kills:") > -1));
                    if (stIndex > -1) item_args["st"] = parseInt(/(\d+)/.exec(item["descriptions"][stIndex].value)[1]);
                    else item_args["st"] = 0;
                    // StatTrak™ Confirmed Kills: 6225 | This item tracks Confirmed Kills.
                }
                //
                inventory_user.push(item_args);
            }
            //
            return resolve(inventory_user);
            //
        });
    }

    // *
    // *** Login
    // *

    async signIn(login) {
        this.login = login;
        this.ownGame = false;
        //
        if (this.controller.base.argExist("nosign")) {
            this.ready = true;
            this.busy = false;
            //this.inventoryItemsScan(null);
            return;
        }
        //
        this.logOnOptions = {
            accountName: login.user,
            password: login.pass,
            authCode: SteamTotp.generateAuthCode(login.shared)
        };

        this.client.logOn(this.logOnOptions);

    }

    // *
    // *** Events
    // *

    bindEventHandlers() {
        this.client.on('error', (e) => {
            this.log(e, 'client');
        });

        this.client.on('disconnected', (eresult, msg) => {
            this.ModuleState.tradeManager = this.ConnectionStatus.Disconnected;
            this.ModuleState.community = this.ConnectionStatus.Disconnected;
            this.ModuleState.client = this.ConnectionStatus.Disconnected;
        });

        this.client.on('loggedOn', () => {
            this.login.steamID = this.client.steamID.getSteamID64();
            this.ModuleState.client = this.ConnectionStatus.Connected;
            //
            if (this.login.sid === 'undefined' || this.login.sid === null || this.login.sid != this.login.steamID) {
                this.steamidSet();
                this.login.sid = this.login.steamID;
            }
        });

        this.client.on('webSession', (sessionID, cookies) => {
            this.tradeManager.setCookies(cookies, async (err) => {
                if (err) {
                    this.log(`${err.message}`, `TradeManager#Error`);
                    process.exit(1); //! Исправить. Fatal error since we couldn't get our API key
                }
                //
                this.pollFile = `tmp/polldata/${this.login.steamID}`;
                if (fs.existsSync(this.pollFile)) this.tradeManager.pollData = JSON.parse(fs.readFileSync(this.pollFile).toString('utf8'));
                //
                this.community.setCookies(cookies);
                //
                this.ModuleState.tradeManager = this.ConnectionStatus.Connected;
                this.ModuleState.community = this.ConnectionStatus.Connected;
                //
                if (this.ownGame && !this.game.haveGCSession) {
                    this.client.gamesPlayed([730]);
                }
            });
        });

        this.client.once('ownershipCached', async () => {
            if (!this.client.ownsApp(730)) {
                this.log(`Retrieving free license of 730`, `ownershipCached`);
                //
                let done = false;
                while (!done) {
                    await this.requestFreeLicense()
                        .then((e) => {
                            this.log(`License for 730 granted`, `requestFreeLicense`);
                            done = true;
                        }).catch(async (e) => {
                            done = false;
                            this.log(`Failed to obtain free 730 license, try again in 10 sec`, `requestFreeLicense`);
                            await this.sleep(10000);
                            // ! Максимальное кол-во повторов
                        });
                }
                //
                this.ownGame = true;
                if (!this.game.haveGCSession) {
                    this.client.gamesPlayed([730]);
                }
            } else {
                this.ownGame = true;
                if (!this.game.haveGCSession) {
                    this.client.gamesPlayed([730]);
                }
            }
        });

        this.game.on('error', (e) => {
            this.log(`${e}`, `GC#Error`);
        });

        this.game.on("connectedToGC", async () => {
            this.ModuleState.gc = this.ConnectionStatus.Connected;
        });

        this.game.on("itemAcquired", (item) => {
            this.log(`${JSON.stringify(item)}`, `itemAcquired#${item.id}`);
        });

        this.game.on("itemCustomizationNotification", (items, type) => {
            this.log(`${items}`, `itemsCustomization#${type}`);
        });

        this.game.on("itemRemoved", (item) => {
            this.log(`${JSON.stringify(item)}`, `itemRemoved#${item.id}`);
        });

        this.game.on("disconnectedFromGC", () => {
            this.ModuleState.gc = this.ConnectionStatus.Disconnected;
        });

        this.tradeManager.on('pollFailure', () => {
            if (this.ModuleState.tradeManager == this.ConnectionStatus.Disconnected) return;
            //
            this.ModuleState.tradeManager = this.ConnectionStatus.Disconnected;
            this.log(`Poll failure`, `TradeManager`);
            //! emit no connection to steam
        });

        this.tradeManager.on('pollSuccess', () => {
            if (this.ModuleState.tradeManager == this.ConnectionStatus.Connected) return;
            //
            this.ModuleState.tradeManager = this.ConnectionStatus.Connected;
            this.log(`Poll success`, `TradeManager`);
            //! emit normal connection to steam
        });

        this.tradeManager.on('sessionExpired', () => {
            this.log(`Session expired`, `TradeManager`);
        });

        this.tradeManager.on('pollData', (pollData) => {
            fs.writeFileSync(this.pollFile, JSON.stringify(pollData));
        });

    }

    // *
    // *** Status 
    // *
    _ready = false;
    busy = false;

    /*
     * @param {*|boolean} val
     */
    set ready(val) {
        if (val !== this._ready) {
            this.emit(val ? 'ready' : 'unready');
        }
        //
        this._ready = val;
    }
    /*
     * Returns the current ready status
     * @return {*|boolean} Ready status
     */
    get ready() {
        return this._ready;
    }

    ConnectionStatus = {
        Disconnected: 0,
        Connected: 1
    }

    ModuleState = {
        t: this,
        _client: this.ConnectionStatus.Disconnected,
        _tradeManager: this.ConnectionStatus.Disconnected,
        _community: this.ConnectionStatus.Disconnected,
        _gc: this.ConnectionStatus.Disconnected,
        /**
         * @param {number} value
         */
        set client(value) {
            this._client = value;
            //
            if (value === this.t.ConnectionStatus.Disconnected)
                this.t.log("Logged off, reconnecting!", "client");
            else
                this.t.log("Ready", "client");
            //
            this.t.readyUpdate();
        },
        get client() { return this._client; },
        set tradeManager(value) {
            this._tradeManager = value;
            //
            if (value === this.t.ConnectionStatus.Disconnected)
                this.t.log("Disconnected", "tradeManager");
            else
                this.t.log("Ready", "tradeManager");
            //
            this.t.readyUpdate();
        },
        get tradeManager() { return this._tradeManager; },
        set community(value) {
            this._community = value;
            //
            if (value === this.t.ConnectionStatus.Disconnected)
                this.t.log("Disconnected", "community");
            else
                this.t.log("Ready", "community");
            //
            this.t.readyUpdate();
        },
        get community() { return this._community; },
        set gc(value) {
            this._gc = value;
            //
            if (value === this.t.ConnectionStatus.Disconnected)
                this.t.log("Disconnected", "GC");
            else
                this.t.log("Ready", "GC");
            //
            this.t.readyUpdate();

        },
        get gc() { return this._gc }
    }

    readyUpdate() {
        if (this.ModuleState.client === this.ConnectionStatus.Connected
            && this.ModuleState.tradeManager === this.ConnectionStatus.Connected
            && this.ModuleState.community === this.ConnectionStatus.Connected
            && this.ModuleState.gc === this.ConnectionStatus.Connected) {
            this.ready = true;
            return;
        }

        this.ready = false;
    }

    // *
    // *** Other
    // *

    // * Запрашиваем бесплатную копию cs2
    requestFreeLicense() {
        return new Promise(async (resolve, reject) => {
            let done = false;
            let error = null;
            //
            this.client.requestFreeLicense(730, (err, grantedPackages, grantedAppIDs) => {
                if (err) {
                    error = err.message;
                    done = true;
                    return;
                }
                //
                done = true;
            });
            while (!done) await this.sleep(150);
            if (error === null) return resolve(true);
            return reject(error);
        })
    }

    // * Сохраняем steamid
    async steamidSet() {
        await this.controller.base.db.setAccountSID(this.login.id, this.login.steamID).then((e) => {
            this.log("Setted", "sid")
        }).catch((e) => {
            this.log(`Error - ${this.login.steamID}`, "sid")
        });
    }

    // * Переменные для item
    getItemArgsInventory(item) {
        let args = { aid: item.id };
        if (typeof (item.actions) !== 'undefined') {
            if (item.actions.length > 0) {
                if (item.actions[0].hasOwnProperty('link')) {
                    args.d = /D(\d+)$/.exec(item.actions[0].link)[1];
                }
            }
        }
        //
        return args;
    }
    getItemArgs(item) {
        let args = { id: item.id, assetid: item.assetid, appid: item.appid };
        if (typeof (item.actions) !== 'undefined') {
            if (item.actions.length > 0) {
                if (item.actions[0].hasOwnProperty('link')) {
                    args.d = /D(\d+)$/.exec(item.actions[0].link)[1];
                }
            }
        }
        //
        return args;
    }

    // * Get totp
    totpGet() {
        return SteamTotp.generateAuthCode(this.login.shared);
    }

    log(text = "", ...args) {
        if (typeof (this.login) !== 'undefined') args.unshift(`${this.login.name}`);
        args.unshift("bot");
        this.controller.base.log(text, ...args);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

}

module.exports = Bot;