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

    async userInventoryFromTrade() {
        this.busy = true;
        //
        let offer = this.tradeManager.createOffer("76561198129661402", "2fz7HpZb");

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
        this.busy = false;
        return { inv: them_inventory, err: them_inventory_err };
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
    getItemArgs(item) {
        let args = { assetid: item.assetid, classid: item.classid, contextid: item.contextid, instanceid: item.instanceid };
        if (typeof (item.new_assetid) !== 'undefined') {
            args.assetid_new = item.new_assetid;
        }
        //
        if (!item.actions) {
            return resolve(args);
        }
        if (item.actions.length > 0) {
            if (item.actions[0].hasOwnProperty('link')) {
                args.d = /D(\d+)$/.exec(item.actions[0].link)[1];
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