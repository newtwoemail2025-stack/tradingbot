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
    console.log("Connected. Joining channels...");
    for (const ch of channels) {
        socket.emit('join', { channelName: ch });
    }
});

let msgCount = 0;
const counts = {};

// We can catch any event by using a proxy or just listening to common ones
const eventsToListen = ['depth-snapshot', 'depth-update', 'trade', 'ticker', 'orderbook', 'depth'];
for (const ev of eventsToListen) {
    socket.on(ev, (msg) => {
        msgCount++;
        counts[ev] = (counts[ev] || 0) + 1;
        if (msgCount % 10 === 0) {
            console.log(`[${new Date().toISOString()}] Received ${msgCount} messages. Counts:`, counts);
        }
    });
}

// Socket.io wildcard fallback
const originalOnEvent = socket.onevent;
socket.onevent = function (packet) {
    const args = packet.data || [];
    const eventName = args[0];
    if (!eventsToListen.includes(eventName)) {
        console.log("Received unexpected event:", eventName);
        counts[eventName] = (counts[eventName] || 0) + 1;
    }
    originalOnEvent.call(this, packet);
};

setTimeout(() => {
    console.log("Final counts:", counts);
    socket.disconnect();
    process.exit(0);
}, 10000);
