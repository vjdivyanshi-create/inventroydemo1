require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const connectDB = require("./src/db/db");
const User = require("./src/models/User");
const Product = require("./src/models/Product");
const Setting = require("./src/models/Setting");
const Order = require("./src/models/Order");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

function getStatus(quantity) {
  if (quantity <= 0) {
    return "out";
  }

  if (quantity < 10) {
    return "low";
  }

  return "in";
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function getRequesterEmail(req) {
  return req.headers["x-user-email"]?.toString().trim().toLowerCase();
}

function requireRequesterEmail(req, res) {
  const ownerEmail = getRequesterEmail(req);

  if (!ownerEmail) {
    res.status(401).json({ message: "User session is missing. Please log in again." });
    return null;
  }

  return ownerEmail;
}

function normalizeProductPayload(body = {}) {
  const parsedQuantity = Number(body.quantity);
  const parsedPrice = Number(body.price);

  return {
    name: body.name?.trim(),
    sku: body.sku?.trim(),
    category: body.category?.trim(),
    quantity: parsedQuantity,
    price: parsedPrice,
  };
}

function normalizeOrderPayload(body = {}) {
  return {
    customerName: body.customerName?.trim(),
    customerEmail: body.customerEmail?.trim().toLowerCase(),
    customerPhone: body.customerPhone?.trim() || "",
    productId: body.productId,
    quantity: Number(body.quantity),
    status: body.status || "Completed",
  };
}

function buildOrderSeries(orders, days = 7) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  const labels = [];
  const revenueMap = new Map();
  const quantityMap = new Map();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  for (let index = 0; index < days; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const key = current.toISOString().slice(0, 10);
    const label = days <= 7
      ? new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(current)
      : formatter.format(current);

    labels.push(label);
    revenueMap.set(key, 0);
    quantityMap.set(key, 0);
  }

  for (const order of orders) {
    const key = new Date(order.createdAt).toISOString().slice(0, 10);

    if (!revenueMap.has(key)) {
      continue;
    }

    revenueMap.set(key, revenueMap.get(key) + order.totalAmount);
    quantityMap.set(key, quantityMap.get(key) + order.quantity);
  }

  return {
    labels,
    revenue: Array.from(revenueMap.values()),
    quantities: Array.from(quantityMap.values()),
  };
}

function buildInventoryValueSeries(products, limit = 6) {
  const rankedProducts = [...products]
    .map((product) => ({
      id: product._id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      quantity: product.quantity,
      price: product.price,
      stockValue: product.quantity * product.price,
      status: product.status,
    }))
    .sort((left, right) => right.stockValue - left.stockValue)
    .slice(0, limit);

  return {
    labels: rankedProducts.map((product) => product.name),
    values: rankedProducts.map((product) => product.stockValue),
    quantities: rankedProducts.map((product) => product.quantity),
    items: rankedProducts,
  };
}

async function adjustProductInventory(productId, quantityDelta, ownerEmail) {
  const product = await Product.findOne({ _id: productId, ...(ownerEmail ? { ownerEmail } : {}) });

  if (!product) {
    throw new Error("Selected product was not found.");
  }

  const nextQuantity = product.quantity + quantityDelta;

  if (nextQuantity < 0) {
    throw new Error(`Not enough stock available for ${product.name}.`);
  }

  product.quantity = nextQuantity;
  product.status = getStatus(product.quantity);
  await product.save();
  return product;
}

async function restoreOrderInventory(order) {
  return adjustProductInventory(order.product, order.quantity, order.ownerEmail);
}

async function applyOrderInventory(productId, quantity, ownerEmail) {
  return adjustProductInventory(productId, -quantity, ownerEmail);
}

async function ensureSettings(user) {
  const existing = await Setting.findOne({ email: user.email });

  if (existing) {
    return existing;
  }

  return Setting.create({
    email: user.email,
    name: user.name,
  });
}

async function findOwnedProductOr404(productId, ownerEmail, res) {
  const product = await Product.findOne({ _id: productId, ownerEmail });

  if (!product) {
    res.status(404).json({ message: "Product not found." });
    return null;
  }

  return product;
}

app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running" });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "Email already registered." });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
    });

    await ensureSettings(user);

    return res.status(201).json({
      message: "Account created successfully.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    await ensureSettings(user);

    return res.json({
      message: "Login successful.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to login." });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const products = await Product.find({ ownerEmail }).sort({ createdAt: -1 });
    return res.json(products);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load products." });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const product = await Product.findOne({ _id: req.params.id, ownerEmail });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    return res.json(product);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load product." });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const { name, sku, category, quantity, price } = normalizeProductPayload(req.body);

    if (!name || !sku || !category || quantity === undefined || price === undefined) {
      return res.status(400).json({ message: "All product fields are required." });
    }

    if (Number.isNaN(quantity) || Number.isNaN(price)) {
      return res.status(400).json({ message: "Quantity and price must be valid numbers." });
    }

    const product = await Product.create({
      ownerEmail,
      name,
      sku,
      category,
      quantity,
      price,
      status: getStatus(quantity),
    });

    return res.status(201).json(product);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "SKU already exists." });
    }

    return res.status(500).json({ message: "Failed to create product." });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const { name, sku, category, quantity, price } = normalizeProductPayload(req.body);

    if (!name || !sku || !category || quantity === undefined || price === undefined) {
      return res.status(400).json({ message: "All product fields are required." });
    }

    if (Number.isNaN(quantity) || Number.isNaN(price)) {
      return res.status(400).json({ message: "Quantity and price must be valid numbers." });
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: req.params.id, ownerEmail },
      {
        name,
        sku,
        category,
        quantity,
        price,
        status: getStatus(quantity),
      },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found." });
    }

    return res.json(updatedProduct);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "SKU already exists." });
    }

    return res.status(500).json({ message: "Failed to update product." });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const deletedProduct = await Product.findOneAndDelete({ _id: req.params.id, ownerEmail });

    if (!deletedProduct) {
      return res.status(404).json({ message: "Product not found." });
    }

    return res.json({ message: "Product deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete product." });
  }
});

app.get("/api/reports/summary", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const requestedDays = Number(req.query.days);
    const days = [7, 30].includes(requestedDays) ? requestedDays : 7;
    const [products, orders] = await Promise.all([
      Product.find({ ownerEmail }).sort({ createdAt: -1 }),
      Order.find({ ownerEmail }).sort({ createdAt: -1 }),
    ]);
    const totalProducts = products.length;
    const totalQuantity = products.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = products.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const lowStock = products.filter((item) => item.status === "low" || item.status === "out").length;
    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, item) => sum + item.totalAmount, 0);
    const categories = products.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.quantity;
      return acc;
    }, {});
    const categoryValueMap = products.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = { quantity: 0, value: 0 };
      }

      acc[item.category].quantity += item.quantity;
      acc[item.category].value += item.quantity * item.price;
      return acc;
    }, {});
    const weeklyOrders = buildOrderSeries(orders, days);
    const inventoryValueSeries = buildInventoryValueSeries(products);
    const categoryValueSeries = Object.entries(categoryValueMap)
      .map(([category, values]) => ({
        category,
        quantity: values.quantity,
        value: values.value,
      }))
      .sort((left, right) => right.value - left.value);
    const analysisStart = new Date();
    analysisStart.setHours(0, 0, 0, 0);
    analysisStart.setDate(analysisStart.getDate() - (days - 1));
    const recentOrderAnalysis = orders.filter((order) => new Date(order.createdAt) >= analysisStart);
    const stockStatusCounts = products.reduce((acc, product) => {
      acc[product.status] = (acc[product.status] || 0) + 1;
      return acc;
    }, { in: 0, low: 0, out: 0 });
    const averageOrderValue = totalOrders ? totalSales / totalOrders : 0;
    const averageProductValue = totalProducts ? totalValue / totalProducts : 0;
    const sellThroughRatio = totalValue ? totalSales / totalValue : 0;
    const highestValueCategory = categoryValueSeries[0]?.category || "No categories yet";
    const topValueProduct = inventoryValueSeries.items[0] || null;
    const lowStockProducts = products
      .filter((product) => product.status === "low" || product.status === "out")
      .sort((left, right) => left.quantity - right.quantity)
      .slice(0, 5);

    return res.json({
      totalProducts,
      totalQuantity,
      totalValue,
      lowStock,
      totalOrders,
      totalSales,
      categories,
      products,
      recentOrders: orders.slice(0, 10),
      recentOrderAnalysis,
      weeklyOrders,
      orderWindowDays: days,
      inventoryValueSeries,
      categoryValueSeries,
      stockStatusCounts,
      averageOrderValue,
      averageProductValue,
      sellThroughRatio,
      highestValueCategory,
      topValueProduct,
      lowStockProducts,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load report summary." });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const orders = await Order.find({ ownerEmail }).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load orders." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const { customerName, customerEmail, customerPhone, productId, quantity, status } = normalizeOrderPayload(req.body);

    if (!customerName || !customerEmail || !productId || Number.isNaN(quantity)) {
      return res.status(400).json({ message: "Customer, product, and quantity are required." });
    }

    if (!isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    if (quantity <= 0) {
      return res.status(400).json({ message: "Order quantity must be greater than zero." });
    }

    let product;

    try {
      product = await applyOrderInventory(productId, quantity, ownerEmail);
    } catch (inventoryError) {
      return res.status(400).json({ message: inventoryError.message });
    }

    if (product.ownerEmail !== ownerEmail) {
      await restoreOrderInventory({ product: product._id, quantity, ownerEmail });
      return res.status(404).json({ message: "Selected product was not found." });
    }

    let order;

    try {
      order = await Order.create({
        ownerEmail,
        customerName,
        customerEmail,
        customerPhone,
        product: product._id,
        productName: product.name,
        productSku: product.sku,
        quantity,
        unitPrice: product.price,
        totalAmount: quantity * product.price,
        status,
      });
    } catch (orderError) {
      await restoreOrderInventory({ product: product._id, quantity, ownerEmail });
      throw orderError;
    }

    return res.status(201).json(order);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create order." });
  }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID." });
    }

    const { customerName, customerEmail, customerPhone, productId, quantity, status } = normalizeOrderPayload(req.body);

    if (!customerName || !customerEmail || !productId || Number.isNaN(quantity)) {
      return res.status(400).json({ message: "Customer, product, and quantity are required." });
    }

    if (!isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    if (quantity <= 0) {
      return res.status(400).json({ message: "Order quantity must be greater than zero." });
    }

    const existingOrder = await Order.findOne({ _id: req.params.id, ownerEmail });

    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found." });
    }

    const previousProductId = existingOrder.product.toString();
    const nextProductId = productId.toString();
    const previousQuantity = existingOrder.quantity;

    if (previousProductId === nextProductId) {
      const product = await Product.findOne({ _id: productId, ownerEmail });

      if (!product || product.ownerEmail !== ownerEmail) {
        return res.status(404).json({ message: "Selected product was not found." });
      }

      const availableQuantity = product.quantity + existingOrder.quantity;

      if (availableQuantity < quantity) {
        return res.status(400).json({ message: "Not enough stock available for this order." });
      }

      product.quantity = availableQuantity - quantity;
      product.status = getStatus(product.quantity);
      await product.save();

      existingOrder.customerName = customerName;
      existingOrder.customerEmail = customerEmail;
      existingOrder.customerPhone = customerPhone;
      existingOrder.product = product._id;
      existingOrder.productName = product.name;
      existingOrder.productSku = product.sku;
      existingOrder.quantity = quantity;
      existingOrder.unitPrice = product.price;
      existingOrder.totalAmount = quantity * product.price;
      existingOrder.status = status;

      await existingOrder.save();
      return res.json(existingOrder);
    }

    await restoreOrderInventory(existingOrder);

    let nextProduct;

    try {
      nextProduct = await applyOrderInventory(productId, quantity, ownerEmail);
    } catch (inventoryError) {
      await adjustProductInventory(previousProductId, -previousQuantity, ownerEmail);
      return res.status(400).json({ message: inventoryError.message });
    }

    if (nextProduct.ownerEmail !== ownerEmail) {
      await restoreOrderInventory({ product: nextProduct._id, quantity, ownerEmail });
      await adjustProductInventory(previousProductId, -previousQuantity, ownerEmail);
      return res.status(404).json({ message: "Selected product was not found." });
    }

    existingOrder.customerName = customerName;
    existingOrder.customerEmail = customerEmail;
    existingOrder.customerPhone = customerPhone;
    existingOrder.product = nextProduct._id;
    existingOrder.productName = nextProduct.name;
    existingOrder.productSku = nextProduct.sku;
    existingOrder.quantity = quantity;
    existingOrder.unitPrice = nextProduct.price;
    existingOrder.totalAmount = quantity * nextProduct.price;
    existingOrder.status = status;

    try {
      await existingOrder.save();
    } catch (saveError) {
      await restoreOrderInventory({ product: nextProduct._id, quantity, ownerEmail });
      await adjustProductInventory(previousProductId, -previousQuantity, ownerEmail);
      throw saveError;
    }

    return res.json(existingOrder);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update order." });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order ID." });
    }

    const order = await Order.findOne({ _id: req.params.id, ownerEmail });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    await restoreOrderInventory(order);
    await Order.findByIdAndDelete(order._id);

    return res.json({ message: "Order deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete order." });
  }
});

app.get("/api/settings/:email", async (req, res) => {
  try {
    const requesterEmail = requireRequesterEmail(req, res);

    if (!requesterEmail) {
      return;
    }

    const email = req.params.email.toLowerCase().trim();

    if (email !== requesterEmail) {
      return res.status(403).json({ message: "You can only access your own settings." });
    }

    const settings = await Setting.findOne({ email });

    if (!settings) {
      return res.status(404).json({ message: "Settings not found." });
    }

    return res.json(settings);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load settings." });
  }
});

app.put("/api/settings/:email", async (req, res) => {
  try {
    const requesterEmail = requireRequesterEmail(req, res);

    if (!requesterEmail) {
      return;
    }

    const email = req.params.email.toLowerCase().trim();

    if (email !== requesterEmail) {
      return res.status(403).json({ message: "You can only update your own settings." });
    }

    const { name, emailAlert, lowStockAlert, theme } = req.body;

    const settings = await Setting.findOneAndUpdate(
      { email },
      {
        $set: {
          ...(name !== undefined ? { name } : {}),
          ...(emailAlert !== undefined ? { emailAlert } : {}),
          ...(lowStockAlert !== undefined ? { lowStockAlert } : {}),
          ...(theme !== undefined ? { theme } : {}),
        },
      },
      { new: true, upsert: true }
    );

    if (name) {
      await User.findOneAndUpdate({ email }, { $set: { name } });
    }

    return res.json(settings);
  } catch (error) {
    return res.status(500).json({ message: "Failed to save settings." });
  }
});

app.put("/api/settings/:email/password", async (req, res) => {
  try {
    const requesterEmail = requireRequesterEmail(req, res);

    if (!requesterEmail) {
      return;
    }

    const email = req.params.email.toLowerCase().trim();

    if (email !== requesterEmail) {
      return res.status(403).json({ message: "You can only update your own password." });
    }

    const { oldPass, newPass } = req.body;

    if (!oldPass || !newPass) {
      return res.status(400).json({ message: "Old and new password are required." });
    }

    if (newPass.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long." });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.password !== oldPass) {
      return res.status(401).json({ message: "Old password is incorrect." });
    }

    user.password = newPass;
    await user.save();

    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update password." });
  }
});

app.get("/api/export/csv", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const products = await Product.find({ ownerEmail }).sort({ createdAt: -1 });
    const rows = [
      ["Name", "SKU", "Category", "Quantity", "Price", "Status"],
      ...products.map((product) => [
        product.name,
        product.sku,
        product.category,
        product.quantity,
        product.price,
        product.status,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=inventory-export.csv");
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export inventory." });
  }
});

app.get("/api/export/excel", async (req, res) => {
  try {
    const ownerEmail = requireRequesterEmail(req, res);

    if (!ownerEmail) {
      return;
    }

    const products = await Product.find({ ownerEmail }).sort({ createdAt: -1 });
    const rows = [
      ["Name", "SKU", "Category", "Quantity", "Price", "Status"],
      ...products.map((product) => [
        product.name,
        product.sku,
        product.category,
        product.quantity,
        product.price,
        product.status,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("Content-Disposition", "attachment; filename=inventory-export.xls");
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export inventory." });
  }
});

app.use((req, res) => {
  return res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ message: "Invalid JSON payload." });
  }

  return res.status(500).json({ message: "Unexpected server error." });
});

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
