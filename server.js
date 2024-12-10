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

// const {
//   ThermalPrinter,
//   PrinterTypes,
//   CharacterSet,
//   BreakLine,
// } = require("node-thermal-printer");

// let printer = new ThermalPrinter({
//   type: PrinterTypes.EPSON,
//   interface: "//./USB001",
// });

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
    "http://localhost:55611"
  );
  next();
});

async function openTable(tableId) {
  try {
    await pool.query(`UPDATE tablestate SET open = $1 WHERE id = $2`, [
      true,
      tableId,
    ]);
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
}

async function closeTable(tableId) {
  try {
    await pool.query(
      `UPDATE tablestate SET open = $1, price = $2 WHERE id = $3`,
      [false, 0, tableId]
    );

    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.tableid = $1 
      AND ois.status = $2 `,
      [tableId, "placed"]
    );

    result = placedItems.rows;

    for (let i = 0; i < result.length; i++) {
      await pool.query(
        `UPDATE orderitemstatus SET status =$1 WHERE orderitemid = $2`,
        ["paid", result[i].id]
      );
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
}

async function updateTablePrice(tableId) {
  try {
    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.tableid = $1 
      AND ois.status = $2 `,
      [tableId, "placed"]
    );

    result = placedItems.rows;
    price = 0;
    for (let i = 0; i < result.length; i++) {
      price += result[i].price * result[i].quantity;
    }
    await pool.query(`UPDATE tablestate SET price = $1 WHERE id = $2`, [
      price,
      tableId,
    ]);
    if (price == 0) {
      closeTable(tableId);
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
}

//route

app.post("/closeAllTable", async (req, res) => {
  try {
    await pool.query("UPDATE tablestate SET price = $1 , open = $2", [
      0,
      false,
    ]);

    await pool.query("UPDATE orderitemstatus SET status = $1", ["cancel"]);
    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/floorplan", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM tablestate ORDER BY id ASC`);

    if (result == null) {
      return {
        message: "let start talking",
      };
    } else {
      req = result.rows;
      res.status(200).send({ req: req });
      return { req: req };
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/getTakeAwayId", async (req, res) => {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const timestamp = `${date.getFullYear()}-${
    month < 10 ? "0" + month : month
  }-${day < 10 ? "0" + day : day}`;
  try {
    const result = await pool.query(
      `SELECT COUNT(id) from takeawayinvoice WHERE created_at = $1`,
      [timestamp]
    );
    newId = parseInt(result.rows[0]["count"]);
    newId += 1;

    res.status(200).send({ newId: newId });

    return newId;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/printQrCode", async (req, res) => {
  const { tableId } = req.body;

  try {
    const result = await openTable(tableId);

    return;
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/takeAwayOrder", async (req, res) => {
  const { order, items } = req.body;
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const timestamp = `${date.getFullYear()}-${
    month < 10 ? "0" + month : month
  }-${day < 10 ? "0" + day : day}`;

  try {
    const result = await pool.query(
      `INSERT INTO takeAwayInvoice (takeAwayId, cash, price, change, payment, created_at) VALUES ($1, $2,$3,$4,$5,$6) RETURNING id`,
      [
        order["takeawayid"],
        order["cash"],
        order["price"],
        order["change"],
        order["payment"],
        timestamp,
      ]
    );

    console.log("result", result.rows[0].id);

    invoiceId = result.rows[0].id;
    for (e of items) {
      await pool.query(
        `INSERT INTO takeAwayItem (takeawayinvoice_id, name, price, quantity, remark) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [invoiceId, e["itemName"], e["itemPrice"], e["quantity"], e["remark"]]
      );
    }

    const itemsResult = await pool.query(
      `SELECT * FROM takeAwayItem WHERE takeawayinvoice_id = $1`,
      [order["takeawayid"]]
    );

    const invoiceResult = await pool.query(
      `SELECT * FROM takeawayinvoice WHERE takeawayid = $1 `,
      [order["takeawayid"]]
    );

    itemsList = itemsResult.rows;
    invoice = invoiceResult.rows;

    res.status(200).send({ invoice: invoice, itemsList: itemsList });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/checkOut", async (req, res) => {
  const { invoice, items } = req.body;
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const timestamp = `${date.getFullYear()}-${
    month < 10 ? "0" + month : month
  }-${day < 10 ? "0" + day : day}`;

  try {
    const result = await pool.query(
      `INSERT INTO invoice (table_id, cash, price, change, payment, created_at) VALUES ($1, $2,$3,$4,$5,$6) RETURNING id`,
      [
        invoice["table_id"],
        invoice["cash"],
        invoice["price"],
        invoice["change"],
        invoice["payment"],
        timestamp,
      ]
    );

    const invoiceId = result.rows[0].id;
    for (e of items) {
      await pool.query(
        `INSERT INTO invoiceitem (invoice_id, name, price, quantity, remark) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [invoiceId, e["itemName"], e["itemPrice"], e["quantity"], e["remark"]]
      );
    }

    const itemsResult = await pool.query(
      `SELECT * FROM invoiceitem WHERE invoice_id = $1`,
      [invoiceId]
    );

    const invoiceResult = await pool.query(
      `SELECT * FROM invoice WHERE table_id = $1 `,
      [invoice["table_id"]]
    );

    const itemsList = itemsResult.rows;
    const invoiceDetail = invoiceResult.rows;
    await closeTable(invoice["table_id"]);

    res.status(200).send({ invoice: invoiceDetail, itemsList: itemsList });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/dayCheckOut", async (req, res) => {
  const { invoice, items } = req.body;
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const timestamp = `${date.getFullYear()}-${
    month < 10 ? "0" + month : month
  }-${day < 10 ? "0" + day : day}`;

  try {
    const result = await pool.query(
      `SELECT * FROM invoice WHERE created_at = $1`,
      [timestamp]
    );

    const takeAwayResult = await pool.query(
      `SELECT * FROM takeawayinvoice WHERE created_at = $1`,
      [timestamp]
    );

    const invoiceList = result.rows;
    const takeAwayInvoiceList = takeAwayResult.rows;

    totalAmount = 0;
    cash = 0;
    octopus = 0;
    weChat = 0;

    for (let i = 0; i < invoiceList.length; i++) {
      note;
      totalAmount += invoiceList[i]["price"];
      if (invoiceList[i]["payment"] == "cash") {
        cash += invoiceList[i]["price"];
      } else if (invoiceList[i]["payment"] == "octopus") {
        octopus += invoiceList[i]["price"];
      } else if (invoiceList[i]["payment"] == "weChat") {
        weChat += invoiceList[i]["price"];
      }
    }

    for (let i = 0; i < takeAwayInvoiceList.length; i++) {
      totalAmount += takeAwayInvoiceList[i]["price"];
      if (takeAwayInvoiceList[i]["payment"] == "cash") {
        cash += takeAwayInvoiceList[i]["price"];
      } else if (takeAwayInvoiceList[i]["payment"] == "octopus") {
        octopus += takeAwayInvoiceList[i]["price"];
      } else if (takeAwayInvoiceList[i]["payment"] == "weChat") {
        weChat += takeAwayInvoiceList[i]["price"];
      }
    }

    res.status(200).send({
      totalAmount: totalAmount,
      cash: cash,
      octopus: octopus,
      weChat: weChat,
    });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/deleteItem", async (req, res) => {
  const { tableId, item } = req.body;
  try {
    const result = await pool.query(
      `UPDATE orderitemstatus SET status = $1 WHERE orderitemid = $2`,
      ["cancel", item["id"]]
    );
    req = result.rows;

    console.log("delete item", req);
    if (req.length >= 1) {
      updateTablePrice(tableId);
    } else {
      closeTable(tableId);
    }

    res.status(200).send({ req: req });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

//isNew = true, does not show flavor, isNew = show all flavors
app.post("/addItems", async (req, res) => {
  const { tableId, items } = req.body;
  try {
    console.log("add item ");

    for (e of items) {
      id = e["id"];
      itemname = e["itemName"];
      price = e["itemPrice"];
      quantity = e["quantity"];
      remark = e["remark"];
      mixedflavors1 = e["mixedFlavors1"];
      mixedflavors2 = e["mixedFlavors2"];
      mixedflavors3 = e["mixedFlavors3"];
      mixedflavors4 = e["mixedFlavors4"];
      moreice = e["moreIce"];
      lessice = e["lessIce"];
      noice = e["noIce"];
      moremilk = e["moreMilk"];
      lessmilk = e["lessMilk"];
      nomilk = e["noMilk"];
      moresweet = e["moreSweet"];
      lesssweet = e["lessSweet"];
      nosweet = e["noSweet"];
      itemtype = e["itemType"];
      takeAway = e["takeAway"];
      noBox = e["noBox"];
      isSetDrink = e["isSetDrink"];
      isNew = e["isNew"];
      isSplit = e["isSplit"];
      console.log("takeAway :  " + takeAway);
      console.log("noBox :  " + noBox);
      if (e["isNew"] == true) {
        const itemResult = await pool.query(
          `INSERT INTO orderitems (tableid, itemname, price, quantity, remark, mixedflavors1, mixedflavors2, mixedflavors3, mixedflavors4, moreice, lessice, noice, moremilk, lessmilk, nomilk, moresweet, lesssweet, nosweet, itemtype, takeaway, nobox, issetdrink, isnew, issplit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21 ,$22, $23 ,$24) RETURNING id`,
          [
            tableId,
            itemname,
            price,
            quantity,
            remark,
            mixedflavors1,
            mixedflavors2,
            mixedflavors3,
            mixedflavors4,
            moreice,
            lessice,
            noice,
            moremilk,
            lessmilk,
            nomilk,
            moresweet,
            lesssweet,
            nosweet,
            itemtype,
            takeAway,
            noBox,
            isSetDrink,
            isNew,
            isSplit,
          ]
        );
        const drink = e["setDrink"];

        const orderItemId = JSON.stringify(itemResult.rows[0].id);

        await pool.query(
          `INSERT INTO orderitemstatus (orderitemid, status) VALUES ($1, $2)`,
          [orderItemId, "placed"]
        );
        if (drink != null) {
          console.log("drink  is not null ");

          const drinkResult = await pool.query(
            `INSERT INTO orderitems (tableid, itemname, price, quantity, remark, mixedflavors1, mixedflavors2, mixedflavors3, mixedflavors4, moreice, lessice, noice, moremilk, lessmilk, nomilk, moresweet, lesssweet, nosweet, itemtype, takeaway, nobox, set_food_id, isnew) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21 ,$22, $23) RETURNING id`,
            [
              tableId,
              drink["itemName"],
              drink["itemPrice"],
              drink["quantity"],
              drink["remark"],
              drink["mixedFlavors1"],
              drink["mixedFlavors2"],
              drink["mixedFlavors3"],
              drink["mixedFlavors4"],
              drink["moreIce"],
              drink["lessIce"],
              drink["noIce"],
              drink["moreMilk"],
              drink["lessMilk"],
              drink["noMilk"],
              drink["moreSweet"],
              drink["lessSweet"],
              drink["noSweet"],
              drink["itemType"],
              drink["takeAway"],
              drink["noBox"],
              orderItemId,
              isNew,
            ]
          );

          const drinkId = JSON.stringify(drinkResult.rows[0].id);

          await pool.query(
            `INSERT INTO orderitemstatus (orderitemid, status) VALUES ($1, $2)`,
            [drinkId, "placed"]
          );
        }
      } else {
        console.log("update item");
        const itemResult = await pool.query(
          `UPDATE orderitems SET tableid =$1, itemname =$2, price =$3, quantity =$4, remark =$5, mixedflavors1 = $6, mixedflavors2 =$7, mixedflavors3 =$8, mixedflavors4 =$9, moreice =$10, lessice =$11, noice = $12, moremilk =$13, lessmilk =$14, nomilk =$15, moresweet =$16, lesssweet =$17, nosweet =$18, takeaway =$19,  nobox = $20, id =$21, issetdrink = $22, isnew = $23, issplit = $24 RETURNING id`,
          [
            tableId,
            itemname,
            price,
            quantity,
            remark,
            mixedflavors1,
            mixedflavors2,
            mixedflavors3,
            mixedflavors4,
            moreice,
            lessice,
            noice,
            moremilk,
            lessmilk,
            nomilk,
            moresweet,
            lesssweet,
            nosweet,
            takeAway,
            noBox,
            id,
            isSetDrink,
            isNew,
            isSplit,
          ]
        );
        console.log("update finished");
      }
    }

    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.tableid = $1 
      AND ois.status = $2 `,
      [tableId, "placed"]
    );

    result = placedItems.rows;

    updateTablePrice(tableId);
    openTable(tableId);

    res.status(200).send({ result: result });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/getTableItems", async (req, res) => {
  const { tableId } = req.query;

  try {
    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.tableid = $1 
      AND ois.status = $2 `,
      [tableId, "placed"]
    );

    result = placedItems.rows;
    if (result == null) {
    } else {
      res.status(200).send({ result: result });
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.get("/getOrderItem", async (req, res) => {
  const { orderItemId } = req.query;

  try {
    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.set_food_id = $1 
      AND ois.status = $2 `,
      [orderItemId, "placed"]
    );

    result = placedItems.rows;

    if (result == null) {
    } else {
      res.status(200).send({ result: result });
    }
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/changeTable", async (req, res) => {
  const { currentTableId, targetTableId } = req.body;

  try {
    const currentTable = await pool.query(
      `SELECT * FROM orderItems WHERE tableid = $1 `,
      [currentTableId]
    );

    const currentTableItems = currentTable.rows;

    const targetTable = await pool.query(
      `SELECT * FROM orderItems WHERE tableid = $1 `,
      [targetTableId]
    );

    const targetTableItems = targetTable.rows;

    for (let i = 0; i < currentTableItems.length; i++) {
      const itemId = currentTableItems[i].id;
      await pool.query(`UPDATE orderItems SET tableid = $1 WHERE id = $2`, [
        targetTableId,
        itemId,
      ]);
    }

    for (let i = 0; i < targetTableItems.length; i++) {
      const itemId = targetTableItems[i].id;

      await pool.query(`UPDATE orderItems SET tableid = $1 WHERE id = $2`, [
        currentTableId,
        itemId,
      ]);
    }

    const targetTableIdItems = await pool.query(
      `SELECT 
        COUNT(*) AS placed_items_count
      FROM orderItems oi
      INNER JOIN orderitemstatus ois
        ON oi.id = ois.orderitemid
      WHERE 
        oi.tableid = $1
        AND ois.status = $2
      `,
      [targetTableId, "placed"]
    );

    const currentTableIdItems = await pool.query(
      `SELECT 
        COUNT(*) AS placed_items_count
      FROM orderItems oi
      INNER JOIN orderitemstatus ois
        ON oi.id = ois.orderitemid
      WHERE 
        oi.tableid = $1
        AND ois.status = $2
      `,
      [currentTableId, "placed"]
    );

    targetTableIdResult = targetTableIdItems.rows[0].placed_items_count;
    currentTableIdItemsResult = currentTableIdItems.rows[0].placed_items_count;
    if (targetTableIdResult > 0) {
      await openTable(targetTableId);
    } else {
      await closeTable(targetTableId);
    }

    if (currentTableIdItemsResult > 0) {
      await openTable(currentTableId);
    } else {
      await closeTable(currentTableId);
    }

    await updateTablePrice(targetTableId);

    await updateTablePrice(currentTableId);

    res
      .status(200)
      .send({ targetTableId: targetTableId, currentTableId: currentTableId });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/margeTable", async (req, res) => {
  const { currentTableId, targetTableId } = req.body;
  try {
    await pool.query(`UPDATE orderItems SET tableid = $1 WHERE tableid = $2`, [
      targetTableId,
      currentTableId,
    ]);

    const placedItems = await pool.query(
      `SELECT 
      oi.*, 
      ois.status
    FROM orderItems oi
    INNER JOIN orderitemstatus ois 
      ON oi.id = ois.orderitemid
    WHERE 
      oi.tableid = $1 
      AND ois.status = $2 `,
      [targetTableId, "placed"]
    );

    await closeTable(currentTableId);

    await openTable(targetTableId);

    await updateTablePrice(targetTableId);

    res
      .status(200)
      .send({ targetTableId: targetTableId, currentTableId: currentTableId });
  } catch (e) {
    console.log(e);
    res.status(500).send({ error: e.message });
  }
});

app.listen(port, () => console.log(`Server has started on port : ${port}`));
