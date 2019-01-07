'use strict';

const fs = require('fs');
const path = require('path');
const { DCReader, decrypt } = require('./dc');

const key = '3f70d21d68a9387957e40e40c6064f6b';
const iv = 'ebf3914c38a2ee376862c333d202f36a';

const DCBasePath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\TERA\\Client\\S1Game\\S1Data'; // <- Path to S1Data
const DCLang = 'EUR'; // 'USA' for NA

const DCPath = path.join(DCBasePath, `DataCenter_Final_${DCLang}.dat`);

const output = path.join(__dirname, '..', 'out', DCLang);

const unpacked = decrypt(DCPath, key, iv);
const DC = new DCReader(unpacked);
const DataCenter = DC.parse({ debug: true, mapStrs: true });

const files = get_files(DataCenter.Elements.data[0].data[0]);

console.time('im done');
Object.keys(files).forEach(file => {
	if (Array.isArray(files[file])) {
		console.log(file, `(x${files[file].length})`);
		for (let n in files[file]) fs.writeFileSync(path.join(output, file, `${file}-${n}.json`), JSON.stringify(build(files[file][n]), null, '\t'));
	} else {
		console.log(file);
		fs.writeFileSync(path.join(output, file + '.json'), JSON.stringify(build(files[file]), null, '\t'));
	}
});
console.timeEnd('im done');

function build(elem) {
	let obj = {};

	if (elem.attribute_count > 0)
		for (let i = 0; i < elem.attribute_count; i++) {
			let ref = DataCenter.Attributes.data[elem.attributes[0]].data[elem.attributes[1] + i];
			let key = get_Name(ref);
			let value = typeof ref.value === 'object' ? get_String(ref.value) : ref.value;
			obj[key] = value;
		}

	if (elem.children_count > 0)
		for (let i = 0; i < elem.children_count; i++) {
			let ref = DataCenter.Elements.data[elem.children[0]].data[elem.children[1] + i];
			let key = get_Name(ref);
			if (!obj[key]) obj[key] = [];
			obj[key].push(build(ref));
		}

	return obj;
}

function get_String(ref) {
	return DataCenter.Strings.map.get(`${ref[0]},${ref[1]}`);
}

function get_Name(ref) {
	if (ref.name_index === 0) return '__placeholder__';
	ref = DataCenter.Names.addresses.data[ref.name_index - 1];
	return DataCenter.Names.map.get(`${ref[0]},${ref[1]}`);
}

function get_files(root) {
	let child = [];
	// console.log(get_Name(root), root);
	for (let i = 0; i < root.children_count; i++) {
		let ref = DataCenter.Elements.data[root.children[0]].data[root.children[1] + i];
		child.push({ ref, name: get_Name(ref) });
	}

	let files = {};
	for (let n of child) {
		if (files[n.name]) {
			if (!Array.isArray(files[n.name])) {
				if (!fs.existsSync(path.join(output, n.name))) fs.mkdirSync(path.join(output, n.name), { recursive: true });
				let temp = files[n.name];
				files[n.name] = [];
				files[n.name].push(temp);
			}
			files[n.name].push(n.ref);
		} else {
			files[n.name] = n.ref;
		}
	}

	// fs.writeFileSync(path.join(__dirname, 'unpack.files.json'), JSON.stringify(files, null, '\t'));
	return files;
}
