"use strict";
// ============================================================
//  LIBERTY HUB — amis, invitations et skins pour Liberty Launcher
//  Node.js >= 18, aucune dépendance. Données : /data/hub.json
// ============================================================
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "8787", 10);
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const FICHIER = path.join(DATA, "hub.json");
const EN_LIGNE_MS = 30000;          // en ligne si vu il y a moins de 30 s
const INVITE_MS = 5 * 60000;        // une invitation expire après 5 min

fs.mkdirSync(DATA, { recursive: true });
let db = { users: {}, invites: [] };
try { db = JSON.parse(fs.readFileSync(FICHIER, "utf8")); } catch (e) {}

let sauvegardePrevue = false;
function sauver() {
	if (sauvegardePrevue) return;
	sauvegardePrevue = true;
	setTimeout(() => {
		sauvegardePrevue = false;
		fs.writeFile(FICHIER + ".tmp", JSON.stringify(db), err => {
			if (!err) fs.rename(FICHIER + ".tmp", FICHIER, () => {});
		});
	}, 500);
}

const hash = t => crypto.createHash("sha256").update(t).digest("hex");
const id = () => crypto.randomBytes(8).toString("hex");

function nouveauCode() {
	const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let c;
	do {
		c = "LIB-" + Array.from(crypto.randomBytes(5), b => a[b % a.length]).join("");
	} while (Object.values(db.users).some(u => u.code === c));
	return c;
}

const propre = (s, max) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const enLigne = u => Date.now() - (u.lastSeen || 0) < EN_LIGNE_MS;
const session = u => (u.session && enLigne(u)) ? u.session : null;
const publicU = u => ({ id: u.id, pseudo: u.pseudo, code: u.code, skin: u.skin || "" });

function repondre(res, code, obj) {
	res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(obj));
}

function lireCorps(req) {
	return new Promise(ok => {
		let d = "";
		req.on("data", c => { d += c; if (d.length > 20000) req.destroy(); });
		req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ok({}); } });
	});
}

function auth(req) {
	const t = req.headers["x-token"];
	if (!t) return null;
	const h = hash(String(t));
	return Object.values(db.users).find(u => u.tokenHash === h) || null;
}

const routes = {
	// Création de compte : { pseudo } -> { id, code, token }
	"POST /api/register": async (req, res, body) => {
		const pseudo = propre(body.pseudo, 24);
		if (pseudo.length < 2) return repondre(res, 400, { erreur: "Pseudo trop court." });
		const token = crypto.randomBytes(24).toString("hex");
		const u = { id: id(), pseudo, code: nouveauCode(), tokenHash: hash(token), skin: "", friends: [], requests: [], lastSeen: Date.now(), session: null };
		db.users[u.id] = u; sauver();
		repondre(res, 200, { id: u.id, code: u.code, token });
	},

	// Profil : { pseudo?, skin? }
	"POST /api/profile": async (req, res, body, u) => {
		if (body.pseudo !== undefined) { const p = propre(body.pseudo, 24); if (p.length >= 2) u.pseudo = p; }
		if (body.skin !== undefined) u.skin = propre(body.skin, 40).toUpperCase().replace(/[^A-Z0-9_]/g, "");
		sauver(); repondre(res, 200, publicU(u));
	},

	// État complet + battement de cœur (appelé toutes les ~5 s par le launcher)
	"GET /api/state": async (req, res, body, u) => {
		u.lastSeen = Date.now();
		db.invites = db.invites.filter(i => Date.now() - i.at < INVITE_MS);
		repondre(res, 200, {
			me: publicU(u),
			friends: u.friends.map(fid => db.users[fid]).filter(Boolean).map(f => ({
				...publicU(f), online: enLigne(f), session: session(f)
			})),
			requests: u.requests.map(rid => db.users[rid]).filter(Boolean).map(publicU),
			invites: db.invites.filter(i => i.to === u.id).map(i => ({
				id: i.id, from: publicU(db.users[i.from] || { id: "", pseudo: "?", code: "" }),
				ip: i.ip, port: i.port, mode: i.mode, nom: i.nom
			}))
		});
	},

	"POST /api/friends/add": async (req, res, body, u) => {
		const code = propre(body.code, 12).toUpperCase();
		const cible = Object.values(db.users).find(x => x.code === code);
		if (!cible) return repondre(res, 404, { erreur: "Code ami inconnu." });
		if (cible.id === u.id) return repondre(res, 400, { erreur: "C'est ton propre code." });
		if (u.friends.includes(cible.id)) return repondre(res, 400, { erreur: "Déjà ami." });
		// Si l'autre m'avait déjà demandé : on accepte directement
		if (u.requests.includes(cible.id)) {
			u.requests = u.requests.filter(x => x !== cible.id);
			u.friends.push(cible.id); cible.friends.push(u.id);
		} else if (!cible.requests.includes(u.id)) {
			cible.requests.push(u.id);
		}
		sauver(); repondre(res, 200, { ok: true });
	},

	"POST /api/friends/accept": async (req, res, body, u) => {
		const autre = db.users[body.id];
		if (!autre || !u.requests.includes(autre.id)) return repondre(res, 404, { erreur: "Demande introuvable." });
		u.requests = u.requests.filter(x => x !== autre.id);
		if (!u.friends.includes(autre.id)) u.friends.push(autre.id);
		if (!autre.friends.includes(u.id)) autre.friends.push(u.id);
		sauver(); repondre(res, 200, { ok: true });
	},

	"POST /api/friends/decline": async (req, res, body, u) => {
		u.requests = u.requests.filter(x => x !== body.id);
		sauver(); repondre(res, 200, { ok: true });
	},

	"POST /api/friends/remove": async (req, res, body, u) => {
		const autre = db.users[body.id];
		u.friends = u.friends.filter(x => x !== body.id);
		if (autre) autre.friends = autre.friends.filter(x => x !== u.id);
		sauver(); repondre(res, 200, { ok: true });
	},

	// Session hébergée : { ip, port, mode, nom } — objet vide = plus d'hébergement
	"POST /api/session": async (req, res, body, u) => {
		if (!body.port) { u.session = null; sauver(); return repondre(res, 200, { ok: true }); }
		const ip = propre(body.ip, 64) || String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
		u.session = { ip, port: parseInt(body.port, 10) || 22000, mode: propre(body.mode, 40), nom: propre(body.nom, 60) };
		sauver(); repondre(res, 200, { ok: true, session: u.session });
	},

	"POST /api/invite": async (req, res, body, u) => {
		const s = session(u);
		if (!s) return repondre(res, 400, { erreur: "Tu n'héberges pas de partie." });
		if (!u.friends.includes(body.to)) return repondre(res, 403, { erreur: "Ce joueur n'est pas ton ami." });
		db.invites = db.invites.filter(i => !(i.from === u.id && i.to === body.to));
		db.invites.push({ id: id(), from: u.id, to: body.to, ip: s.ip, port: s.port, mode: s.mode, nom: s.nom, at: Date.now() });
		sauver(); repondre(res, 200, { ok: true });
	},

	"POST /api/invites/dismiss": async (req, res, body, u) => {
		db.invites = db.invites.filter(i => !(i.id === body.id && i.to === u.id));
		sauver(); repondre(res, 200, { ok: true });
	},

	// Adresse IP vue par le hub (aide pour l'hébergement)
	"GET /api/myip": async (req, res) => {
		repondre(res, 200, { ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim() });
	},

	"GET /api/health": async (req, res) => repondre(res, 200, { ok: true, joueurs: Object.keys(db.users).length })
};

const PUBLIQUES = new Set(["POST /api/register", "GET /api/myip", "GET /api/health"]);

http.createServer(async (req, res) => {
	const url = (req.url || "").split("?")[0];
	const cle = req.method + " " + url;
	const route = routes[cle];
	if (!route) return repondre(res, 404, { erreur: "Route inconnue." });
	try {
		const body = req.method === "POST" ? await lireCorps(req) : {};
		let u = null;
		if (!PUBLIQUES.has(cle)) {
			u = auth(req);
			if (!u) return repondre(res, 401, { erreur: "Non connecté." });
		}
		await route(req, res, body, u);
	} catch (e) {
		console.error(e);
		repondre(res, 500, { erreur: "Erreur serveur." });
	}
}).listen(PORT, () => console.log("Liberty Hub sur le port " + PORT));
