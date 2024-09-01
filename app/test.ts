import * as dgram from "dgram";
import { Buffer } from "buffer";

const PORT = 2053;
const client = dgram.createSocket("udp4");

const testCases = [
    {
        description: "Test DNS query with header and question section",
        message: Buffer.from("00000100000100000000000003777777076578616d706c6503636f6d0000010001", "hex"),
    },
    {
        description: "Test DNS query with compressed question section",
        message: Buffer.from("00000100000100000000000003777777076578616d706c6503636f6d0000010001c00c00010001", "hex"),
    },
    {
        description: "Test DNS query with multiple questions",
        message: Buffer.from("00000100000200000000000003777777076578616d706c6503636f6d000001000103777777076578616d706c6503636f6d0000010001", "hex"),
    },
];

testCases.forEach((testCase, index) => {
    client.send(testCase.message, PORT, "127.0.0.1", (err) => {
        if (err) {
            console.error(`[${new Date().toISOString()}] Error sending message for test case ${index + 1}:`, err);
        } else {
            console.log(`[${new Date().toISOString()}] ${testCase.description} sent`);
        }
    });
});

client.on("message", (msg, rinfo) => {
    console.log(`[${new Date().toISOString()}] Received response: ${msg.toString('hex')}`);
    client.close();
});