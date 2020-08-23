"use strict";

const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

function decrypt(DataCenterPath, key, iv) {
  if (key.length !== 32) throw Error("Invalid key length");
  if (iv.length !== 32) throw Error("Invalid IV length");

  const original = fs.readFileSync(DataCenterPath);
  console.log("original size", original.length);
  console.log("original sha256", sha(original));

  const decipher = crypto.createDecipheriv(
    "aes-128-cfb",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "hex")
  );
  let decrypted = decipher.update(original);
  decipher.final();
  console.log("decrypted size", decrypted.length);
  console.log("decrypted sha256", sha(decrypted));

  if (decrypted.readUInt16LE(4) !== 0x9c78) throw Error("Incorrect key/iv");

  let unpacked = zlib.inflateSync(decrypted.slice(4, decrypted.length));
  console.log("unpacked size", unpacked.length);
  console.log("unpacked sha256", sha(unpacked));

  return unpacked;
}

class DCReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;

    this.TypeCode = new Map()
      .set(1, () => {
        return this.UInt32();
      })
      .set(2, () => {
        return this.Float();
      })
      .set(5, () => {
        const value = this.UInt32();
        if (![0, 1].includes(value))
          throw Error("Attributes(): not a bool", value);
        return Boolean(value);
      });
  }

  parse({ debug = false, mapStrs = false }) {
    mapStrs = mapStrs ? ["Strings", "Names"] : [];

    if (debug) console.time("DCReader.parse()");
    const parsed = {};

    if (debug) console.log("DCReader.parse(): Reading Header");
    parsed.Header = this.Header();

    if (debug) console.log("DCReader.parse(): Reading Unk1");
    parsed.Unk1 = this.Region({ type: "Unk1" });

    if (debug) console.log("DCReader.parse(): Reading Attributes");
    parsed.Attributes = this.Region({
      type: "Region",
      opts: { type: "Attributes", writeactual: true },
    });

    if (debug) console.log("DCReader.parse(): Reading Elements");
    parsed.Elements = this.Region({
      type: "Region",
      opts: { type: "Elements", writeactual: true },
    });

    if (debug) console.log("DCReader.parse(): Reading Strings");
    parsed.Strings = this.StringRegion(1024);

    if (mapStrs.includes("Strings")) {
      if (debug) console.log("DCReader.parse(): Mapping Strings");
      parsed.Strings.map = new Map();
      for (const index in parsed.Strings.values.data) {
        const strings = parsed.Strings.values.data[index].value.split("\0");
        let size = 0;
        for (let string in strings) {
          parsed.Strings.map.set(`${index},${size}`, strings[string]);
          size += strings[string].length + 1;
        }
      }
    }

    if (debug) console.log("DCReader.parse(): Reading Names");
    parsed.Names = this.StringRegion(512);

    if (mapStrs.includes("Names")) {
      if (debug) console.log("DCReader.parse(): Mapping Names");
      parsed.Names.map = new Map();
      for (const index in parsed.Names.values.data) {
        const names = parsed.Names.values.data[index].value.split("\0");
        let size = 0;
        for (let name in names) {
          parsed.Names.map.set(`${index},${size}`, names[name]);
          size += names[name].length + 1;
        }
      }
    }

    if (this.buffer.length === this.offset) {
      console.log("DCReader.parse(): Missing Footer!"); // yo pinkie why are u deleting the footer in ur dc mod
      parsed.Footer = { unk1: 0 };
    } else {
      if (debug) console.log("DCReader.parse(): Reading Footer");
      parsed.Footer = this.Footer();
    }

    if (this.buffer.length === this.offset) {
      if (debug) {
        console.log("DCReader.parse(): Done!");
        console.timeEnd("DCReader.parse()");
      }
      return parsed;
    } else {
      throw Error(
        `ERR @ DCReader.parse(): ${this.buffer.length - this.offset} bytes left`
      );
    }
  }

  Header() {
    let unk1 = this.UInt32();
    let unk2 = this.UInt32();
    let unk3 = this.UInt32();
    let version = this.UInt32();
    let unk4 = this.UInt32();
    let unk5 = this.UInt32();
    let unk6 = this.UInt32();
    let unk7 = this.UInt32();
    return { unk1, unk2, unk3, version, unk4, unk5, unk6, unk7 };
  }

  Unk1() {
    return [this.UInt32(), this.UInt32()];
  }

  Address() {
    return [this.UInt16(), this.UInt16()];
  }

  Attributes() {
    let name_index = this.UInt16();
    let type = this.UInt16();
    let value = null;
    if (this.TypeCode.has(type)) value = this.TypeCode.get(type)();
    else value = this.Address();
    this.offset += 4; // padding, 64-bit only
    return { name_index, type, value };
  }

  Elements() {
    let name_index = this.UInt16();
    let unk1 = this.UInt16();
    let attribute_count = this.UInt16();
    let children_count = this.UInt16();
    let attributes = this.Address();
    this.offset += 4; // padding, 64-bit only
    let children = this.Address();
    this.offset += 4; // padding, 64-bit only
    return {
      name_index,
      unk1,
      attribute_count,
      children_count,
      attributes,
      children,
    };
  }

  StringRegion(size) {
    let values = this.Region({ type: "Str" });
    let metadata = this.Region({
      type: "Region",
      opts: { type: "Meta" },
      size,
      writesize: false,
    });
    let addresses = this.Region({ type: "Address", offby: -1 });
    return { values, metadata, addresses };
  }

  Str() {
    let size = this.UInt32();
    let used = this.UInt32();
    let value = this.slice(size * 2).toString("ucs2");
    return { size, used, value };
  }

  Meta() {
    let unk1 = this.UInt32();
    let length = this.UInt32();
    let id = this.UInt32();
    let address = this.Address();
    return { unk1, length, id, address };
  }

  Footer() {
    return [this.UInt32()];
  }

  Region({
    type = [],
    opts = {},
    size = 0,
    actual = 0,
    offby = 0,
    writesize = true,
    writeactual = false,
    debug = false,
  }) {
    let data = {};

    if (writesize) {
      size = this.UInt32();
      if (debug) console.log("DCReader.Region(): writesize", size);
    }
    if (writeactual) {
      actual = this.UInt32();
      if (debug) console.log("DCReader.Region(): writeactual", actual);
    }

    size += offby;

    let arr = [];

    for (let i = 0; i < size; i++) arr.push(this[type](opts));

    if (writesize) data.size = size;
    if (writeactual) data.actual = actual;
    if (arr[0]) data.data = arr;

    return data;
  }

  slice(length) {
    let data = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  Float(offset) {
    if (offset) this.offset = offset;
    let data = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return data;
  }

  UInt16(offset) {
    if (offset) this.offset = offset;
    let data = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return data;
  }

  UInt32(offset) {
    if (offset) this.offset = offset;
    let data = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return data;
  }
}

module.exports = { decrypt, DCReader };

function sha(data) {
  return crypto.createHash("SHA256").update(data).digest("hex");
}
