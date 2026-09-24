const io = require('socket.io-client');
const socket = io('wss://stream.coindcx.com', { transports: ['websocket'] });

socket.on('connect', () => {
    console.log("Connected, joining channel...");
    socket.emit('join', { channelName: 'B-SOL_USDT@orderbook@50-futures' });
});

socket.on('depth-snapshot', (data) => {
    console.log("RECEIVED DEPTH SNAPSHOT:");
    console.log(JSON.stringify(data, null, 2));
    socket.disconnect();
    process.exit(0);
});

setTimeout(() => {
    console.log("Timeout");
    process.exit(1);
}, 10000);
