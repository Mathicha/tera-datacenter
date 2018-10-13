const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

function decrypt(DataCenterPath, key, iv) {
	if (key.length !== 32) throw Error('Invalid key length');
	if (iv.length !== 32) throw Error('Invalid IV length');

	const original = fs.readFileSync(DataCenterPath);
	console.log('original size', original.length);
	console.log('original sha256', sha(original));

	const decipher = crypto.createDecipheriv('aes-128-cfb', StringToByteArray(key), StringToByteArray(iv));
	let decrypted = decipher.update(original);
	decipher.final();
	console.log('decrypted size', decrypted.length);
	console.log('decrypted sha256', sha(decrypted));

	if (decrypted.readUInt16LE(4) !== 0x9c78) throw Error('Incorrect key/iv');

	let unpacked = zlib.inflateSync(decrypted.slice(4, decrypted.length));
	console.log('unpacked size', unpacked.length);
	console.log('unpacked sha256', sha(unpacked));

	return unpacked;
}

class DCReader {
	constructor(buffer) {
		this.buffer = buffer;
		this.offset = 0;
		this.parsed = {};
	}

	parse(debug) {
		if (debug) console.time('DCReader.parse()');
		this.parsed = {};

		if (debug) console.log('DCReader.parse(): Reading Header');
		this.parsed.Header = this.Header();

		if (debug) console.log('DCReader.parse(): Reading Unk1');
		this.parsed.Unk1 = this.Region({ type: this.Unk1.bind(this) });

		if (debug) console.log('DCReader.parse(): Reading Attributes');
		this.parsed.Attributes = this.Region({ type: this.Region.bind(this), opts: { type: this.Attributes.bind(this), writeactual: true } });

		if (debug) console.log('DCReader.parse(): Reading Elements');
		this.parsed.Elements = this.Region({ type: this.Region.bind(this), opts: { type: this.Elements.bind(this), writeactual: true } });

		if (debug) console.log('DCReader.parse(): Reading Strings');
		this.parsed.Strings = this.StringRegion(1024);

		if (debug) console.log('DCReader.parse(): Reading Names');
		this.parsed.Names = this.StringRegion(512);

		if (this.buffer.length === this.offset) {
			console.log('DCReader.parse(): Missing Footer!'); // yo pinkie why are u deleting the footer in ur dc mod
			this.parsed.Footer = { unk1: 0 };
		} else {
			if (debug) console.log('DCReader.parse(): Reading Footer');
			this.parsed.Footer = this.Footer();
		}

		if (this.buffer.length === this.offset) {
			if (debug) {
				console.log('DCReader.parse(): Done!');
				console.timeEnd('DCReader.parse()');
			}
			return this.parsed;
		} else {
			throw Error(`ERR @ DCReader.parse(): ${this.buffer.length - this.offset} bytes left`);
		}
	}

	Header() {
		let unk1 = this.UInt32LE();
		let unk2 = this.UInt32LE();
		let unk3 = this.UInt32LE();
		let version = this.UInt32LE();
		let unk4 = this.UInt32LE();
		let unk5 = this.UInt32LE();
		let unk6 = this.UInt32LE();
		let unk7 = this.UInt32LE();
		return { unk1, unk2, unk3, version, unk4, unk5, unk6, unk7 };
	}

	Unk1() {
		let unk1 = this.UInt32LE();
		let unk2 = this.UInt32LE();
		return { unk1, unk2 };
	}

	Address() {
		let segment_index = this.UInt16LE();
		let element_index = this.UInt16LE();
		return { segment_index, element_index };
	}

	Attributes() {
		let name_index = this.UInt16LE();
		let type = this.UInt16LE();
		let value = null;
		switch (type) {
			case 1:
				value = this.UInt32LE();
				break;
			case 2:
				value = this.FloatLE();
				break;
			case 5:
				value = this.UInt32LE();
				if (![0, 1].includes(value)) throw Error('Attributes(): not a bool', value);
				value = Boolean(value);
				break;
			default:
				value = this.Address();
				break;
		}
		return { name_index, type, value };
	}

	Elements() {
		let name_index = this.UInt16LE();
		let unk1 = this.UInt16LE();
		let attribute_count = this.UInt16LE();
		let children_count = this.UInt16LE();
		let attributes = this.Address();
		let children = this.Address();
		return { name_index, unk1, attribute_count, children_count, attributes, children };
	}

	StringRegion(size) {
		let values = this.Region({ type: this.Str.bind(this) });
		let metadata = this.Region({ type: this.Region.bind(this), opts: { type: this.Meta.bind(this) }, size, writesize: false });
		let addresses = this.Region({ type: this.Address.bind(this), offby: -1 });
		return { values, metadata, addresses };
	}

	Str() {
		let size = this.UInt32LE();
		let x = this.UInt32LE();
		let value = this.slice(size * 2)
			.toString('ucs2')
			.split('\0');
		let index = 0;
		let values = {};
		for (let i = 0; i < value.length; i++) {
			values[index] = value[i];
			index += value[i].length + 1;
		}
		return { size, x, values };
	}

	Meta() {
		let unk1 = this.UInt32LE();
		let length = this.UInt32LE();
		let id = this.UInt32LE();
		let address = this.Address();
		return { unk1, length, id, address };
	}

	Footer() {
		let unk1 = this.UInt32LE();
		return [unk1];
	}

	Region({ type = [], opts = {}, size = 0, actual = 0, offby = 0, writesize = true, writeactual = false, debug = false }) {
		let data = {};

		if (writesize) {
			size = this.UInt32LE();
			if (debug) console.log('DCReader.Region(): writesize', size);
		}
		if (writeactual) {
			actual = this.UInt32LE();
			if (debug) console.log('DCReader.Region(): writeactual', actual);
		}

		size += offby;

		let arr = [];

		for (let i = 0; i < size; i++) {
			arr.push(type(opts));
		}

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

	FloatLE(offset) {
		if (offset) this.offset = offset;
		let data = this.buffer.readFloatLE(this.offset);
		this.offset += 4;
		return data;
	}

	UInt16LE(offset) {
		if (offset) this.offset = offset;
		let data = this.buffer.readUInt16LE(this.offset);
		this.offset += 2;
		return data;
	}

	UInt32LE(offset) {
		if (offset) this.offset = offset;
		let data = this.buffer.readUInt32LE(this.offset);
		this.offset += 4;
		return data;
	}
}

module.exports = { decrypt, DCReader };

function StringToByteArray(str) {
	let buf = Buffer.alloc(16);
	for (let i = 0; i < str.length; i += 2) buf[i / 2] = Buffer.from(str.substr(i, 2), 'hex')[0];
	return buf;
}

function sha(data) {
	return crypto
		.createHash('SHA256')
		.update(data)
		.digest('hex');
}
