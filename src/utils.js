const fs = require('fs-extra');
const path = require('path');
const { homedir, tmpdir } = require('os');

// eslint-disable-next-line
const https = require('https');
const child_process = require('child_process');
const URL = require('url');
const Agent = require('https-proxy-agent');
const rimrafCallback = require('rimraf');

const tmpDirName = 'tmp';
const rimraf = dir => new Promise(res => rimrafCallback(dir, res));

const degitConfigName = 'degit.json';

const homeOrTmp = homedir() || tmpdir();

class DegitError extends Error {
	constructor(message, opts) {
		super(message);
		Object.assign(this, opts);
	}
}

function tryRequire(file, opts) {
	try {
		if (opts && opts.clearCache === true) {
			delete require.cache[require.resolve(file)];
		}
		return require(file);
	} catch (err) {
		return null;
	}
}

function exec(command) {
	return new Promise((fulfil, reject) => {
		child_process.exec(command, (err, stdout, stderr) => {
			if (err) {
				reject(err);
				return;
			}

			fulfil({ stdout, stderr });
		});
	});
}

function fetch(url, dest, proxy) {
	return new Promise((fulfil, reject) => {
		let options = url;

		if (proxy) {
			const parsedUrl = URL.parse(url);
			options = {
				hostname: parsedUrl.host,
				path: parsedUrl.path,
				agent: new Agent(proxy)
			};
		}

		https
			.get(options, response => {
				const code = response.statusCode;
				if (code >= 400) {
					reject({ code, message: response.statusMessage });
				} else if (code >= 300) {
					fetch(response.headers.location, dest, proxy).then(fulfil, reject);
				} else {
					response
						.pipe(fs.createWriteStream(dest))
						.on('finish', () => fulfil())
						.on('error', reject);
				}
			})
			.on('error', reject);
	});
}

async function stashFiles(dir, dest) {
	const tmpDir = path.join(dir, tmpDirName);
	try {
		await rimraf(tmpDir);
	} catch (e) {
		if (e.errno !== -2 && e.syscall !== 'rmdir' && e.code !== 'ENOENT') {
			throw e;
		}
	}
	await fs.mkdir(tmpDir);
	const files = await fs.readdir(dest);
	for (const file of files) {
		const filePath = path.join(dest, file);
		const targetPath = path.join(tmpDir, file);
		const isDir = (await fs.lstat(filePath)).isDirectory();
		if (isDir) {
			await fs.copy(filePath, targetPath);
			await rimraf(filePath);
		} else {
			await fs.copy(filePath, targetPath);
			await fs.unlink(filePath);
		}
	}
}

async function unstashFiles(dir, dest) {
	const tmpDir = path.join(dir, tmpDirName);
	const files = await fs.readdir(tmpDir);
	for (const filename of files) {
		const tmpFile = path.join(tmpDir, filename);
		const targetPath = path.join(dest, filename);
		const isDir = (await fs.lstat(tmpFile)).isDirectory();
		if (isDir) {
			await fs.copy(tmpFile, targetPath);
			await rimraf(tmpFile);
		} else {
			if (filename !== 'degit.json') {
				await fs.copy(tmpFile, targetPath);
			}
			await fs.unlink(tmpFile);
		}
	}
	await rimraf(tmpDir);
}

class Spinner {
	constructor(message = '') {
		this.message = message;
		this.spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
		this.intervalId = null;
	}

	message(message) {
		this.message = message;
		return this;
	}

	start() {
		let i = 0;
		this.intervalId = setInterval(() => {
			process.stdout.write(`\r${this.spinners[i]} ${this.message}`);
			i = (i + 1) % this.spinners.length;
		}, 100);
	}

	stop() {
		clearInterval(this.intervalId);
		process.stdout.clearLine();
		process.stdout.cursorTo(0);
	}

	succeed() {
		this.stop();
		console.log(`\r✔ ${this.message}`);
	}

	fail() {
		this.stop();
		console.log(`\r× ${this.message}`);
	}
}

const base = path.join(homeOrTmp, '.degit');

module.exports = {
	rimraf,
	degitConfigName,
	DegitError,
	tryRequire,
	fetch,
	exec,
	stashFiles,
	unstashFiles,
	base,
  Spinner
};
