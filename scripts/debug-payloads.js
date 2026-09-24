const io = require('socket.io-client');

const socket = io('wss://stream.coindcx.com', {
    transports: ['websocket']
});

const channels = [
    'B-SOL_USDT@orderbook@50-futures',
    'B-SOL_USDT@depth@50-futures',
    'B-SOL_USDT@depth',
    'B-SOL_USDT@orderbook',
    'B-SOL_USDT@trade',
    'B-SOL_USDT@trades',
    'B-SOL_USDT@ticker',
];

socket.on('connect', () => {
    for (const ch of channels) {
        socket.emit('join', { channelName: ch });
    }
});

let gotDepth = false;
let gotTrade = false;

socket.onevent = function (packet) {
    const args = packet.data || [];
    const eventName = args[0];
    const data = args[1];

    if (eventName === 'depth-update' && !gotDepth) {
        console.log("DEPTH UPDATE:");
        console.log(JSON.stringify(data, null, 2));
        gotDepth = true;
    }
    if (eventName === 'new-trade' && !gotTrade) {
        console.log("NEW TRADE:");
        console.log(JSON.stringify(data, null, 2));
        gotTrade = true;
    }

    if (gotDepth && gotTrade) {
        socket.disconnect();
        process.exit(0);
    }
};

setTimeout(() => {
    socket.disconnect();
    process.exit(1);
}, 10000);
