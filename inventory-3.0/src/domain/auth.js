const crypto = require("node:crypto");
const { db } = require("../db");
const { httpError } = require("../lib/http");

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("=") || "")];
  }).filter(([key]) => key));
}

function getPilotPassword() {
  return process.env.PILOT_PASSWORD || "pilot";
}

function login({ memberId, role, password }) {
  if (String(password || "") !== getPilotPassword()) {
    throw httpError(401, "Invalid password.");
  }
  if (!["Regular User", "Admin User"].includes(role)) {
    throw httpError(400, "Invalid role.");
  }
  let member = null;
  if (memberId && memberId !== "guest") {
    member = db.prepare("SELECT * FROM team_members WHERE id = ? AND active = 1").get(Number(memberId));
    if (!member) throw httpError(400, "Member not found.");
  } else {
    member = { id: null, name: "Guest / not listed", email: "guest@lab-pilot.example", username: "guest" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    token,
    memberId: member.id,
    memberName: member.name,
    email: member.email,
    role,
    createdAt: Date.now(),
  };
  sessions.set(token, session);
  return session;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const token = cookies.inventory3_session || bearer;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireSession(req) {
  const session = getSession(req);
  if (!session) throw httpError(401, "Authentication required.");
  return session;
}

function requireAdmin(session) {
  if (session.role !== "Admin User") throw httpError(403, "Admin access required.");
}

function actorFromSession(session) {
  return session.memberName || "Inventory User";
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `inventory3_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

module.exports = {
  login,
  getSession,
  requireSession,
  requireAdmin,
  actorFromSession,
  sessionCookie,
  getPilotPassword,
};
