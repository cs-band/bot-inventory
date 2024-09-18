const botClass = require('./bot'),
    fs = require('fs'),
    //{ DateTime } = require("luxon"),
    EventEmitter = require('events').EventEmitter;

class botController extends EventEmitter {
    bots = [];
    queueTypes = {};

    constructor(base) {
        super();
        //
        this.base = base;
        //
        if (!fs.existsSync('tmp/polldata/')) fs.mkdirSync('tmp/polldata/', { recursive: true });
    }

    async start() {
        this.log(`Started`);
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

        bot.on('queueReceipt', (queue) => {
            this.log(`Catch receipt`, `${bot.login.name}`, `queue#${queue.id}`);
            //
            this.queueBotReceipts.push({ id: queue.id, bid: bot.login.id, response: queue.response });
        })

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

    botGetFree() {
        // Shuffle array to evenly distribute requests
        for (let bot of this.shuffleArray(this.bots)) {
            if (!bot.busy && bot.ready) return bot;
        }

        return false;
    }
   
    botGetById(id) {
        let i = this.bots.findIndex(x => x.login.id == id);
        if (i < 0) return null;
        return this.bots[i];
    }

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