import * as dgram from "dgram";

const PORT = 12053;
const client = dgram.createSocket("udp4");
const message = Buffer.from("00000100000100000000000003777777076578616d706c6503636f6d0000010001", "hex");

client.send(message, PORT, "127.0.0.1", (err) => {
    if (err) {
        console.error("Error sending message:", err);
    } else {
        console.log(`[${new Date().toISOString()}] Test DNS query sent`);
    }
});

client.on("message", (msg, rinfo) => {
    console.log(`[${new Date().toISOString()}] Received response: ${msg.toString('hex')}`);
    client.close();
});