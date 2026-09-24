const WebSocket = require('ws');
const ws = new WebSocket('wss://stream.coindcx.com');
ws.on('open', () => {
    console.log("Connected");
    ws.send(JSON.stringify({ channelName: 'B-SOL_USDT@orderbook', action: 'sub' }));
});
ws.on('message', (data) => {
    console.log(data.toString());
});
setTimeout(() => process.exit(0), 5000);
