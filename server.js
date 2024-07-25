const express = require("express");
const nodemailer = require("nodemailer");
require("dotenv").config();
const cors = require("cors");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const mailPW = process.env.mailPW;
const pool = require("./db");
const port = 3000;
const bcrypt = require("bcryptjs");

const client = new Client({
  connectionString: process.env.connectionString,
});

const app = express();
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3010 });

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "https://codetest-50146-fc1f6.web.app/",
    "http://localhost:64080"
  );
  next();
});

async function hashPassword(plainPassword) {
  let SALT_ROUNDS = 10;
  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  return hash;
}

async function checkPassword(plainPassword, hashedPassword) {
  const isMatched = await bcrypt.compare(plainPassword, hashedPassword);
  return isMatched;
}

//route
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Access denied" });
  }
  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    req.user = decoded;
    if (decoded) {
      next();
    }
  } catch (err) {
    res.status(400).json({ message: "Invalid token" });
  }
};

app.get("/home", verifyToken, (req, res) => {
  if (req.user) {
    res.json({
      message: "User already authenticated",
    });
  } else {
    res.json({
      message: "Please login first",
    });
  }
});

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const existingEmail = await pool.query(
      `SELECT * FROM users WHERE email = ($1)`,
      [email]
    );

    if (existingEmail.data === undefined) {
      const hashedPassword = await hashPassword(password);
      const result = await pool.query(
        "INSERT INTO users (email, password) VALUES ($1, $2)",
        [email, hashedPassword]
      );

      return {
        message: `Successfully register  : ${result.email}`,
      };
    } else {
      return {
        error: "repeated email please use other or forgot password",
      };
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query("select * from users where email = ($1)", [
      email,
    ]);

    const isMatched = await checkPassword(password, user.rows[0].password);

    if (isMatched === true) {
      const token = jwt.sign(
        {
          id: user._id,
          username: user.username,
          exp: Math.floor(Date.now() / 1000) + 60 * 60,
        },
        process.env.SECRET_KEY
      );

      res.status(200).send({
        token: token,
        userId: user.rows[0].id,
        userEmail: user.rows[0].email,
      });
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/addMessage", async (req, res) => {
  const { sendId, receiverId, content } = req.body;
  try {
    await pool.query(
      "INSERT INTO message (sender_id, receiver_id, content) VALUES ($1, $2, $3)",
      [sendId, receiverId, content]
    );
    res.status(200).send({ message: "Successfully added child" });

    client.connect((err, client, done) => {
      if (err) {
        console.log("server error", err);
      } else {
        client.on("notification", (msg) => {
          wss.clients.forEach((client) => {
            const data = JSON.parse(msg.payload);
            console.log("Sender ID:", data["sender_id"]);
            if (data["sender_id"] == sendId || data["receiver_id"] == sendId) {
              console.log(msg.payload);
              client.send(msg.payload);
            }
          });
        });

        const query = client.query("LISTEN updated");
      }
    });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.get("/chatList", async (req, res) => {
  const { userId } = req.query;
  try {
    const result = [];

    const senderList = await pool.query(`SELECT * FROM users WHERE id != 1;`);

    const list = senderList.rows;

    for (senderId of list) {
      const lastMessage = await pool.query(
        `SELECT * FROM message WHERE  sender_id = ($1) and receiver_id = ($2) Order By date DESC LIMIT 1`,
        [userId, senderId.id]
      );

      if (lastMessage.rows[0] == null) {
        result.push({
          senderId: senderId.id,
          senderEmail: senderId.email,
          sms: "",
          date: null,
        });
      } else {
        result.push({
          senderId: senderId.id,
          senderEmail: senderId.email,
          sms: lastMessage.rows[0]["content"],
          date: lastMessage.rows[0]["date"],
        });
      }
    }

    result.sort((a, b) => a.sms.data > b.sms.data);
    res.status(200).send({ result: result });
    return { result: result };
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/chatroom", async (req, res) => {
  const { userId, receiverId } = req.query;
  try {
    const resultUserId = await pool.query(
      `SELECT * FROM message WHERE sender_id = ${userId} and receiver_id = ${receiverId} ORDER BY date ASC`
    );
    const resultReceiverId = await pool.query(
      `SELECT * FROM message WHERE sender_id = ${receiverId} and receiver_id = ${userId} ORDER BY date ASC`
    );

    result = resultUserId["rows"].concat(resultReceiverId["rows"]);

    if (result == null) {
      return {
        message: "let start talking",
      };
    } else {
      res.status(200).send({ result: result });
      return { result: result };
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/opt", async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query(
      `SELECT email FROM users WHERE email = ($1)`,
      [email]
    );

    if (result.rows[0].email === undefined) {
      return {
        error: "email not exist",
      };
    } else {
      const otp = Math.floor(1000 + Math.random() * 9000);

      const otpExpier = new Date();
      otpExpier.setMinutes(otpExpier.getMinutes() + 1);

      const result = await pool.query(
        `
  INSERT INTO opt (email, opt, otpexpier)
  VALUES ($1, $2, $3)
  RETURNING *
`,
        [email, otp, otpExpier]
      );

      if (result.rows[0] === undefined) {
        return {
          error: "retry",
        };
      } else {
        const transporter = nodemailer.createTransport({
          service: "Gmail",
          auth: {
            user: "tansonkk@gmail.com",
            pass: mailPW,
          },
        });

        const dateTime = new Date(result.rows[0].otpexpier);

        const hkOffset = 480;

        dateTime.setMinutes(dateTime.getMinutes() - hkOffset);

        const hours = dateTime.getHours();
        const minutes = dateTime.getMinutes();
        const seconds = dateTime.getSeconds();

        const min = minutes < 10 ? "0" + minutes : minutes;
        const sec = seconds < 10 ? "0" + seconds : seconds;

        const hkTime = `${hours}:${min}:${sec} (HKT)`;

        const mailOptions = {
          from: "tansonkk@gmail.com",
          to: result.rows[0].email,
          subject: "Password reset OTP",
          text: `Your OTP ( expired time ${hkTime}) : ${result.rows[0].opt}`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            return {
              error: error.message,
            };
          } else {
            res.json({
              data: "Your OTP send to the email",
            });
          }
        });
      }
    }
  } catch (e) {}
});

app.post("/resetpassword", async (req, res) => {
  const { email, opt, newPassword, confirmPassword } = req.body;
  try {
    if (newPassword != confirmPassword) {
      return {
        error: "new password must match confirm password",
      };
    }
    const existingEmail = await pool.query(
      `SELECT * FROM opt WHERE email = ($1)`,
      [email]
    );

    if (existingEmail === undefined) {
      return {
        error: "email not exist",
      };
    }

    const now = new Date();
    const nowTime = new Date(now);
    nowTime.setMinutes(now.getMinutes() + 5);

    const checkingOPT = await pool.query(`select * from opt where opt =($1)`, [
      opt,
    ]);

    if (checkingOPT.rows[0]["otpexpier"] > nowTime) {
      return {
        error: "opt not match or expired",
      };
    } else {
      const hash = await hashPassword(newPassword);

      const result = await pool.query(
        `UPDATE users SET password =($1) Where email = ($2) `,
        [hash, email]
      );

      if (result) {
        return res.status(200).send();
      }

      return res.status(400).send();
    }
  } catch (e) {}
});

app.listen(port, () => console.log(`Server has started on port : ${port}`));
