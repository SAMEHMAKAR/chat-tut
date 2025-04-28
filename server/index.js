// server/index.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config(); // To load environment variables from .env
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;

// Dummy User Data
const users = [
  {
    id: 1,
    username: "student1",
    password: "$2b$10$UiGHfJm636v4JOOGS3Hpaui7PY/Gw.jFi6DiAtUptW0h0q/d.yxxy", // "password123"
  },
];

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Login Route
app.post("/api/login", async (req, res) => {
  console.log("Incoming login request body:", req.body);

  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  const user = users.find((u) => u.username === username);
  if (!user) {
    return res.status(400).json({ error: "Invalid credentials (username)" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ error: "Invalid credentials (password)" });
  }

  const payload = { userId: user.id, username: user.username };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
  res.json({ token });
});

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const header = req.header("Authorization");
  const token = header && header.split(" ")[1];
  if (!token)
    return res.status(401).json({ error: "Authorization token is missing" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Protected route example
app.get("/api/protected", verifyToken, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

// Stripe payment route
app.post("/payment", async (req, res) => {
  try {
    const { amount, token } = req.body;
    const charge = await stripe.charges.create({
      amount,
      currency: "usd",
      source: token.id,
      description: "Payment for tutoring session",
    });
    res.status(200).send(charge);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Payment failed" });
  }
});

// Socket.io real-time & WebRTC signaling
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Chat messaging
  socket.on("sendMessage", (message) => {
    io.emit("receiveMessage", message);
  });

  // ===== WebRTC Signaling Handlers =====

  // Join a video room
  socket.on("join room", (roomID) => {
    const clients = io.sockets.adapter.rooms.get(roomID) || new Set();
    const otherUser = [...clients][0];
    if (otherUser) {
      // Notify the newcomer of the existing peer
      socket.emit("other user", otherUser);
    }
    socket.join(roomID);
  });

  // Offer from caller to callee
  socket.on("offer", ({ target, caller, sdp }) => {
    io.to(target).emit("offer", { caller, sdp });
  });

  // Answer from callee back to caller
  socket.on("answer", ({ target, caller, sdp }) => {
    io.to(target).emit("answer", { caller, sdp });
  });

  // ICE candidates exchange
  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", { candidate, from: socket.id });
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
