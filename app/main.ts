import * as dgram from "dgram";

const udpSocket: dgram.Socket = dgram.createSocket("udp4");
udpSocket.bind(2053, "127.0.0.1");

udpSocket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
    try {
        console.log(`Received data from ${rinfo.address}:${rinfo.port}`);
        const response = Buffer.from("");
        udpSocket.send(response, rinfo.port, rinfo.address);
    } catch (e) {
        console.log(`Error sending data: ${e}`);
    }
});

udpSocket.on("listening", () => {
    console.log("UDP socket is listening on port 2053");
});