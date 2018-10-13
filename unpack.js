const fs = require('fs');
const path = require('path');
const { DCReader, decrypt } = require('./dc');

const key = '37932a264632304665012971b4b15723';
const iv = '2da88f24fc41556f347878199ce5ee01';

const DCBasePath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\TERA\\Client\\S1Game\\S1Data';
const DCLang = 'EUR';

const DCPath = path.join(DCBasePath, `DataCenter_Final_${DCLang}.dat`);

let output = path.join(__dirname, 'out');
if (!fs.existsSync(output)) fs.mkdirSync(output);
output = path.join(output, DCLang);
if (!fs.existsSync(output)) fs.mkdirSync(output);

const unpacked = decrypt(DCPath, key, iv);
const DC = new DCReader(unpacked);
const DataCenter = DC.parse(true);

// fs.writeFileSync(path.join(__dirname, 'out', `${DCLang}.json`), JSON.stringify({ version: DataCenter.Header.version, key, iv }));

let files = get_files(DataCenter.Elements.data[0].data[0]);

console.time('im done');
for (let f of Object.keys(files)) {
	if (Array.isArray(files[f])) {
		console.log(f, `(x${files[f].length})`);
		for (let n in files[f]) {
			let name = `${f}-${n}`;
			fs.writeFileSync(path.join(output, f, name + '.json'), JSON.stringify(build(files[f][n]), null, '\t'));
		}
	} else {
		console.log(f);
		fs.writeFileSync(path.join(output, f + '.json'), JSON.stringify(build(files[f]), null, '\t'));
	}
}
console.timeEnd('im done');

function build(elem) {
	let obj = {};

	if (elem.attribute_count > 0)
		for (let i = 0; i < elem.attribute_count; i++) {
			let ref = DataCenter.Attributes.data[elem.attributes.segment_index].data[elem.attributes.element_index + i];
			let key = get_Name(ref);
			let value = typeof ref.value === 'object' ? get_String(ref.value) : ref.value;
			obj[key] = value;
		}

	if (elem.children_count > 0)
		for (let i = 0; i < elem.children_count; i++) {
			let ref = DataCenter.Elements.data[elem.children.segment_index].data[elem.children.element_index + i];
			let key = get_Name(ref);
			if (!obj[key]) obj[key] = [];
			obj[key].push(build(ref));
		}

	return obj;
}

function get_String(ref) {
	return DataCenter.Strings.values.data[ref.segment_index].values[ref.element_index];
}

function get_Name(ref) {
	if (ref.name_index === 0) return null; //return '__placeholder__'
	const addr = DataCenter.Names.addresses.data[ref.name_index - 1];
	return DataCenter.Names.values.data[addr.segment_index].values[addr.element_index];
}

function get_files(root) {
	let child = [];
	// console.log(get_Name(root), root);
	for (let i = 0; i < root.children_count; i++) {
		let ref = DataCenter.Elements.data[root.children.segment_index].data[root.children.element_index + i];
		child.push({ ref, name: get_Name(ref) });
	}

	let files = {};
	for (let n of child) {
		if (n.name === null) continue; //

		if (files[n.name]) {
			if (!Array.isArray(files[n.name])) {
				if (!fs.existsSync(path.join(output, n.name))) fs.mkdirSync(path.join(output, n.name));
				let temp = files[n.name];
				files[n.name] = [];
				files[n.name].push(temp);
			}
			files[n.name].push(n.ref);
		} else {
			files[n.name] = n.ref;
		}
	}

	// fs.writeFileSync('files.json', JSON.stringify(files, null, '\t'));
	return files;
}
