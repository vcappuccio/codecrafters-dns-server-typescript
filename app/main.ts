import * as dgram from 'dgram';
import { argv } from 'process';

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket('udp4');

type Question = {
  domain: string;
  qType: number;
  qClass: number;
};

type DNSRecord = Question & {
  ttl: number;
  data: string;
};

type Label = {
  offset: number;
  content: string;
  next?: Label;
};

function followOffsets({
  labels,
  labelOffsetMap,
  offset,
}: {
  labels: Label[];
  labelOffsetMap: Record<number, Label>;
  offset: number;
}) {
  let currentLabel: Label | undefined = labelOffsetMap[offset];
  while (currentLabel) {
    labels.push(currentLabel);
    currentLabel = currentLabel.next;
  }
}

function parseQuestionSection(questionSection: Buffer, offset: number): Question[] {
  let i = offset;
  const questions: Question[] = [];
  
  while (i < questionSection.length) {
    const domain = parseDomainName(questionSection, i);
    i += domain.byteLength;
    
    if (i + 4 > questionSection.length) {
      break;
    }
    
    const qType = questionSection.readUInt16BE(i);
    i += 2;
    const qClass = questionSection.readUInt16BE(i);
    i += 2;
    
    questions.push({ domain: domain.name, qType, qClass });
  }
  
  return questions;
}

function parseDomainName(buffer: Buffer, offset: number): { name: string; byteLength: number } {
  const labels: string[] = [];
  let i = offset;
  let byteLength = 0;

  while (true) {
    const length = buffer[i];

    if (length === 0) {
      byteLength++;
      break;
    }

    if ((length & 0xc0) === 0xc0) {
      const pointerOffset = ((length & 0x3f) << 8) | buffer[i + 1];
      const pointerResult = parseDomainName(buffer, pointerOffset);
      labels.push(...pointerResult.name.split('.'));
      byteLength += 2;
      break;
    }

    i++;
    byteLength += length + 1;
    labels.push(buffer.slice(i, i + length).toString('ascii'));
    i += length;
  }

  return { name: labels.join('.'), byteLength };
}

function recordToQuestion(record: DNSRecord) {
  // ... function body ...
}

function recordToAnswer(record: DNSRecord) {
  // ... function body ...
}

class DNSMessage {
  private packetId: number;
  private queryResponse: boolean;
  private opCode: number;
  private authoritativeAnswer: boolean = false;
  private truncation: boolean = false;
  private recursionDesired: boolean;
  private recursionAvailable: boolean = false;
  private responseCode: number = 0;
  private records: DNSRecord[];

  constructor(queryData?: Buffer) {
    if (queryData) {
      this.packetId = queryData.readUInt16BE(0);
      this.queryResponse = true;
      const opCodeByteAndRdByte = queryData[2];
      this.opCode = (opCodeByteAndRdByte >> 3) & 0b0111;
      this.recursionDesired = Boolean(opCodeByteAndRdByte & 0b00000001);
      this.records = parseQuestionSection(queryData, 12).map((question) => ({
        ...question,
        ttl: 60,
        data: '8.8.8.8',
      }));
    } else {
      throw new Error('DNSMessage question mode not implemented');
    }
  }
  // ... rest of the class ...
}

class DNS {
  parseQuestion(data: Buffer, startOffset: number): [string, number] {
    let labels: string[] = [];
    let offset = startOffset;
    let jumping = false;
    let jumpOffset = -1;

    while (offset < data.length) {
      const length = data[offset];
      if (length === 0) {
        if (!jumping) offset++;
        break;
      }
      if ((length & 0xC0) === 0xC0) {
        if (!jumping) {
          jumpOffset = offset + 2;
        }
        jumping = true;
        offset = ((length & 0x3F) << 8) | data[offset + 1];
        continue;
      }
      if (offset + length + 1 > data.length) break;
      labels.push(data.subarray(offset + 1, offset + 1 + length).toString("ascii"));
      offset += length + 1;
      if (jumping && jumpOffset !== -1) {
        offset = jumpOffset;
        jumping = false;
        jumpOffset = -1;
      }
    }

    return [labels.join('.'), offset];
  }
}

udpSocket.on('message', (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
  try {
    const response = new DNSMessage(data).toBuffer();
    udpSocket.send(response, remoteAddr.port, remoteAddr.address);
  } catch (e) {
    console.log(`Error sending data: ${e}`);
  }
});
udpSocket.bind(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});
