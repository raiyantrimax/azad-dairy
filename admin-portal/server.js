require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket, ObjectId } = require('mongodb');

const app = express();
const port = Number(process.env.PORT || 10000);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-this');
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);

if (!jwtSecret) throw new Error('Set JWT_SECRET before starting the service.');

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || !corsOrigins.length || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('This origin is not allowed by CORS.'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const addressSchema = new mongoose.Schema({
  label: { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home' },
  recipientName: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  line1: { type: String, trim: true, required: true },
  line2: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, required: true },
  state: { type: String, trim: true, default: '' },
  postalCode: { type: String, trim: true, default: '' },
  landmark: { type: String, trim: true, default: '' },
  latitude: Number,
  longitude: Number,
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  addresses: [addressSchema],
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  category: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  unit: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  image: { type: String, default: '🥛' },
  images: [{ type: String }],
  tags: [{ type: String, trim: true }],
  rating: { type: Number, default: 0, min: 0, max: 5 },
  subscriptionAllowed: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  discount: {
    kind: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    value: { type: Number, default: 0, min: 0 },
    startsAt: Date,
    endsAt: Date,
  },
}, { timestamps: true });
productSchema.index({ name: 'text', description: 'text', category: 'text', tags: 'text' });

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  description: { type: String, default: '', trim: true },
  kind: { type: String, enum: ['percentage', 'fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  minimumOrder: { type: Number, default: 0, min: 0 },
  maximumDiscount: { type: Number, default: 0, min: 0 },
  startsAt: Date,
  endsAt: Date,
  maxUses: { type: Number, default: 0, min: 0 },
  usedCount: { type: Number, default: 0, min: 0 },
  productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  active: { type: Boolean, default: true },
}, { timestamps: true });

const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productSnapshot: {
    name: String,
    unit: String,
    image: String,
    price: Number,
  },
  plan: { type: String, enum: ['Daily', 'Weekly', 'Alternate', 'Monthly'], required: true },
  quantity: { type: Number, required: true, min: 1 },
  deliveryDays: [{ type: String, enum: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] }],
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['scheduled', 'active', 'expired', 'cancelled'], default: 'active' },
  endedAt: Date,
  endReason: { type: String, default: '' },
}, { timestamps: true });
subscriptionSchema.index({ status: 1, endDate: 1 });

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderNumber: { type: String, required: true, unique: true },
  status: { type: String, enum: ['placed', 'processing', 'delivered', 'cancelled'], default: 'placed' },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    unit: String,
    quantity: Number,
    listPrice: Number,
    unitPrice: Number,
    discount: Number,
    lineTotal: Number,
  }],
  addressSnapshot: mongoose.Schema.Types.Mixed,
  couponCode: { type: String, default: '' },
  subtotal: { type: Number, required: true },
  productDiscount: { type: Number, default: 0 },
  couponDiscount: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  total: { type: Number, required: true },
  subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
  subscriptionSnapshot: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
orderSchema.index({ user: 1, createdAt: -1 });

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Coupon = mongoose.model('Coupon', couponSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Order = mongoose.model('Order', orderSchema);

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const isValidId = (id) => mongoose.isValidObjectId(id);
const parseList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) ? result : value.split(',').map((part) => part.trim()).filter(Boolean);
  } catch {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
};
const cleanUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  addresses: user.addresses.map((address) => ({
    id: String(address._id),
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    landmark: address.landmark,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
  })),
  createdAt: user.createdAt,
});
const makeToken = (user) => jwt.sign({ sub: String(user._id), role: user.role }, jwtSecret, { expiresIn: '14d' });

const requireAuth = (role) => asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  let claims;
  try {
    claims = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
  const user = await User.findById(claims.sub);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'This account is unavailable.' });
  if (role && user.role !== role) return res.status(403).json({ error: 'Administrator access required.' });
  req.user = user;
  next();
});

const imageBucket = () => new GridFSBucket(mongoose.connection.db, { bucketName: 'productImages' });
const imageUrl = (id) => `/api/images/${id}`;
const discountIsActive = (discount, now = new Date()) => Boolean(
  discount?.value > 0
  && (!discount.startsAt || discount.startsAt <= now)
  && (!discount.endsAt || discount.endsAt >= now)
);
const discountAmount = (price, discount) => {
  if (!discountIsActive(discount)) return 0;
  const amount = discount.kind === 'percentage' ? price * discount.value / 100 : discount.value;
  return Math.min(price, Math.max(0, amount));
};
const productView = (product) => {
  const data = product.toObject ? product.toObject() : product;
  const sale = discountAmount(data.price, data.discount);
  return {
    id: String(data._id || data.id),
    name: data.name,
    slug: data.slug,
    category: data.category,
    description: data.description,
    unit: data.unit,
    price: Math.max(0, data.price - sale),
    originalPrice: data.price,
    mrp: data.mrp,
    stock: data.stock,
    image: data.image || '🥛',
    images: (data.images || []).map(imageUrl),
    imageIds: data.images || [],
    tags: data.tags || [],
    rating: data.rating || 0,
    subscriptionAllowed: data.subscriptionAllowed !== false,
    active: data.active !== false,
    discount: data.discount || { kind: 'percentage', value: 0 },
    discountAmount: sale,
  };
};
const productBody = (body) => {
  const name = String(body.name || '').trim();
  const slug = String(body.slug || name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const price = Number(body.price);
  const mrp = Number(body.mrp ?? body.price);
  if (!name || !slug || !body.category || !body.description || !body.unit) throw Object.assign(new Error('Name, category, description, unit, price and MRP are required.'), { status: 400 });
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(mrp) || mrp < price) throw Object.assign(new Error('Enter valid prices. MRP must be at least the base price.'), { status: 400 });
  const discount = body.discount || {};
  return {
    name,
    slug,
    category: String(body.category).trim(),
    description: String(body.description).trim(),
    unit: String(body.unit).trim(),
    price,
    mrp,
    stock: Math.max(0, Number(body.stock || 0)),
    image: String(body.image || '🥛'),
    images: parseList(body.images).filter(isValidId).map(String),
    tags: parseList(body.tags).map((tag) => String(tag).trim()).filter(Boolean),
    rating: Math.min(5, Math.max(0, Number(body.rating || 0))),
    subscriptionAllowed: body.subscriptionAllowed !== false && body.subscriptionAllowed !== 'false',
    active: body.active !== false && body.active !== 'false',
    discount: {
      kind: discount.kind === 'fixed' ? 'fixed' : 'percentage',
      value: Math.max(0, Number(discount.value || 0)),
      startsAt: discount.startsAt ? new Date(discount.startsAt) : undefined,
      endsAt: discount.endsAt ? new Date(discount.endsAt) : undefined,
    },
  };
};
const couponBody = (body) => ({
  code: String(body.code || '').trim().toUpperCase(),
  description: String(body.description || '').trim(),
  kind: body.kind === 'fixed' ? 'fixed' : 'percentage',
  value: Math.max(0, Number(body.value || 0)),
  minimumOrder: Math.max(0, Number(body.minimumOrder || 0)),
  maximumDiscount: Math.max(0, Number(body.maximumDiscount || 0)),
  startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
  endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
  maxUses: Math.max(0, Number(body.maxUses || 0)),
  productIds: parseList(body.productIds).filter(isValidId),
  active: body.active !== false && body.active !== 'false',
});

const todayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};
const refreshSubscriptionStatuses = async () => {
  const today = todayStart();
  await Promise.all([
    Subscription.updateMany(
      { status: 'active', endDate: { $ne: null, $lt: today } },
      { $set: { status: 'expired', endedAt: new Date(), endReason: 'end_date_reached' } }
    ),
    Subscription.updateMany(
      { status: 'scheduled', startDate: { $lte: today }, $or: [{ endDate: null }, { endDate: { $gte: today } }] },
      { $set: { status: 'active' } }
    ),
    Subscription.updateMany(
      { status: 'scheduled', endDate: { $ne: null, $lt: today } },
      { $set: { status: 'expired', endedAt: new Date(), endReason: 'end_date_reached' } }
    ),
  ]);
};
const subscriptionView = (subscription) => ({
  id: String(subscription._id),
  userId: String(subscription.user?._id || subscription.user),
  userName: subscription.user?.name || '',
  userEmail: subscription.user?.email || '',
  productId: String(subscription.product?._id || subscription.product),
  product: subscription.product?.name ? {
    id: String(subscription.product._id),
    name: subscription.product.name,
    image: subscription.product.image,
    unit: subscription.product.unit,
    price: subscription.product.price,
  } : subscription.productSnapshot,
  plan: subscription.plan,
  quantity: subscription.quantity,
  deliveryDays: subscription.deliveryDays,
  startDate: subscription.startDate,
  endDate: subscription.endDate,
  status: subscription.status,
  createdAt: subscription.createdAt,
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'azad-dairy-admin-api' }));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Name, a valid email, and a password of at least 8 characters are required.' });
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = await User.create({ name, email, phone, passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: makeToken(user), user: cleanUser(user) });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  res.json({ token: makeToken(user), user: cleanUser(user) });
}));

app.get('/api/auth/me', requireAuth(), asyncHandler(async (req, res) => {
  res.json({ user: cleanUser(req.user) });
}));

app.get('/api/products', asyncHandler(async (req, res) => {
  const query = { active: true };
  if (req.query.category && req.query.category !== 'All') query.category = String(req.query.category);
  if (req.query.search) query.$text = { $search: String(req.query.search) };
  const products = await Product.find(query).sort({ category: 1, name: 1 }).limit(200);
  res.json({ products: products.map(productView) });
}));

app.get('/api/products/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
  const product = await Product.findOne({ _id: req.params.id, active: true });
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product: productView(product) });
}));

app.get('/api/images/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).end();
  const bucket = imageBucket();
  const [file] = await bucket.find({ _id: new ObjectId(req.params.id) }).toArray();
  if (!file) return res.status(404).end();
  res.set('Content-Type', file.metadata?.contentType || 'application/octet-stream');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  bucket.openDownloadStream(file._id).on('error', () => res.destroy()).pipe(res);
}));

app.get('/api/me', requireAuth(), asyncHandler(async (req, res) => res.json({ user: cleanUser(req.user) })));
app.patch('/api/me', requireAuth(), asyncHandler(async (req, res) => {
  if (req.body.name !== undefined) req.user.name = String(req.body.name).trim();
  if (req.body.phone !== undefined) req.user.phone = String(req.body.phone).trim();
  await req.user.save();
  res.json({ user: cleanUser(req.user) });
}));

app.post('/api/me/addresses', requireAuth(), asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (!data.line1 || !data.city) return res.status(400).json({ error: 'Street address and city are required.' });
  if (data.isDefault) req.user.addresses.forEach((address) => { address.isDefault = false; });
  if (!req.user.addresses.length) data.isDefault = true;
  req.user.addresses.push(data);
  await req.user.save();
  res.status(201).json({ addresses: req.user.addresses });
}));

app.patch('/api/me/addresses/:id', requireAuth(), asyncHandler(async (req, res) => {
  const address = req.user.addresses.id(req.params.id);
  if (!address) return res.status(404).json({ error: 'Address not found.' });
  if (req.body.isDefault) req.user.addresses.forEach((item) => { item.isDefault = false; });
  Object.assign(address, req.body);
  await req.user.save();
  res.json({ addresses: req.user.addresses });
}));

app.delete('/api/me/addresses/:id', requireAuth(), asyncHandler(async (req, res) => {
  const address = req.user.addresses.id(req.params.id);
  if (!address) return res.status(404).json({ error: 'Address not found.' });
  const wasDefault = address.isDefault;
  req.user.addresses.pull({ _id: address._id });
  if (wasDefault && req.user.addresses.length) req.user.addresses[0].isDefault = true;
  await req.user.save();
  res.json({ addresses: req.user.addresses });
}));

app.get('/api/me/subscriptions', requireAuth(), asyncHandler(async (req, res) => {
  await refreshSubscriptionStatuses();
  const subscriptions = await Subscription.find({ user: req.user._id }).populate('product').sort({ createdAt: -1 });
  res.json({ subscriptions: subscriptions.map(subscriptionView) });
}));

app.patch('/api/me/subscriptions/:id/cancel', requireAuth(), asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({ _id: req.params.id, user: req.user._id });
  if (!subscription) return res.status(404).json({ error: 'Subscription not found.' });
  if (subscription.status === 'active' || subscription.status === 'scheduled') {
    subscription.status = 'cancelled';
    subscription.endedAt = new Date();
    subscription.endReason = 'cancelled_by_user';
    await subscription.save();
  }
  res.json({ subscription: subscriptionView(await subscription.populate('product')) });
}));

app.get('/api/me/orders', requireAuth(), asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ orders });
}));

app.post('/api/coupons/validate', requireAuth(), asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const productIds = parseList(req.body.productIds).filter(isValidId);
  const amount = Math.max(0, Number(req.body.amount || 0));
  const coupon = await Coupon.findOne({ code, active: true });
  if (!coupon) return res.status(404).json({ error: 'Coupon is invalid or inactive.' });
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return res.status(400).json({ error: 'Coupon is not active yet.' });
  if (coupon.endsAt && coupon.endsAt < now) return res.status(400).json({ error: 'Coupon has expired.' });
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return res.status(400).json({ error: 'Coupon usage limit has been reached.' });
  if (amount < coupon.minimumOrder) return res.status(400).json({ error: `Minimum order is ₹${coupon.minimumOrder}.` });
  if (coupon.productIds.length && !productIds.some((id) => coupon.productIds.some((allowed) => String(allowed) === id))) {
    return res.status(400).json({ error: 'Coupon does not apply to these products.' });
  }
  const rawDiscount = coupon.kind === 'percentage' ? amount * coupon.value / 100 : coupon.value;
  const savings = Math.min(amount, coupon.maximumDiscount ? Math.min(rawDiscount, coupon.maximumDiscount) : rawDiscount);
  res.json({ coupon: { code: coupon.code, kind: coupon.kind, value: coupon.value }, savings: Math.round(savings * 100) / 100 });
}));

app.post('/api/orders', requireAuth(), asyncHandler(async (req, res) => {
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!requestedItems.length) return res.status(400).json({ error: 'Your cart is empty.' });
  const quantities = new Map();
  for (const item of requestedItems) {
    if (!isValidId(item.productId) || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
      return res.status(400).json({ error: 'One or more cart items are invalid.' });
    }
    quantities.set(String(item.productId), (quantities.get(String(item.productId)) || 0) + Number(item.quantity));
  }
  const productsById = new Map((await Product.find({ _id: { $in: [...quantities.keys()] }, active: true })).map((product) => [String(product._id), product]));
  if (productsById.size !== quantities.size) return res.status(400).json({ error: 'A cart product is unavailable. Refresh your cart and try again.' });

  let subtotal = 0;
  let productDiscount = 0;
  const items = [];
  for (const [productId, quantity] of quantities) {
    const product = productsById.get(productId);
    if (product.stock < quantity) return res.status(409).json({ error: `${product.name} does not have enough stock.` });
    const saleDiscount = discountAmount(product.price, product.discount);
    const unitPrice = Math.round((product.price - saleDiscount) * 100) / 100;
    const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
    subtotal += lineTotal;
    productDiscount += saleDiscount * quantity;
    items.push({
      product: product._id,
      name: product.name,
      unit: product.unit,
      quantity,
      listPrice: product.price,
      unitPrice,
      discount: Math.round(saleDiscount * quantity * 100) / 100,
      lineTotal,
    });
  }

  let couponDiscount = 0;
  let coupon;
  const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
  if (couponCode) {
    coupon = await Coupon.findOne({ code: couponCode, active: true });
    if (!coupon) return res.status(400).json({ error: 'Coupon is invalid or inactive.' });
    const now = new Date();
    if ((coupon.startsAt && coupon.startsAt > now) || (coupon.endsAt && coupon.endsAt < now)) return res.status(400).json({ error: 'Coupon is outside its validity dates.' });
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return res.status(400).json({ error: 'Coupon usage limit has been reached.' });
    if (subtotal < coupon.minimumOrder) return res.status(400).json({ error: `Minimum order is ₹${coupon.minimumOrder}.` });
    if (coupon.productIds.length && !items.some((item) => coupon.productIds.some((allowed) => String(allowed) === String(item.product)))) {
      return res.status(400).json({ error: 'Coupon does not apply to these products.' });
    }
    const rawDiscount = coupon.kind === 'percentage' ? subtotal * coupon.value / 100 : coupon.value;
    couponDiscount = Math.round(Math.min(subtotal, coupon.maximumDiscount ? Math.min(rawDiscount, coupon.maximumDiscount) : rawDiscount) * 100) / 100;
  }

  let subscription;
  let subscriptionData;
  let subscriptionSnapshot;
  if (req.body.subscription) {
    const input = req.body.subscription;
    const product = productsById.get(String(input.productId));
    if (!product || !product.subscriptionAllowed) return res.status(400).json({ error: 'This product cannot be subscribed to.' });
    const startDate = new Date(input.startDate);
    const endDate = input.endDate ? new Date(input.endDate) : null;
    if (!Number.isFinite(startDate.getTime()) || startDate < todayStart()) return res.status(400).json({ error: 'Choose today or a future subscription start date.' });
    if (endDate && (!Number.isFinite(endDate.getTime()) || endDate < startDate)) return res.status(400).json({ error: 'The subscription end date must be on or after its start date.' });
    const plan = ['Daily', 'Weekly', 'Alternate', 'Monthly'].includes(input.plan) ? input.plan : null;
    const quantity = Math.floor(Number(input.quantity));
    const deliveryDays = parseList(input.deliveryDays).filter((day) => ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].includes(day));
    if (!plan || quantity < 1 || (plan === 'Weekly' && !deliveryDays.length)) return res.status(400).json({ error: 'Choose a valid plan, quantity and delivery days.' });
    const status = startDate > todayStart() ? 'scheduled' : 'active';
    subscriptionData = {
      user: req.user._id,
      product: product._id,
      productSnapshot: { name: product.name, unit: product.unit, image: product.image, price: productView(product).price },
      plan,
      quantity,
      deliveryDays: plan === 'Weekly' ? deliveryDays : [],
      startDate,
      endDate,
      status,
    };
    subscriptionSnapshot = {
      productId: String(product._id),
      productName: product.name,
      plan,
      quantity,
      deliveryDays: plan === 'Weekly' ? deliveryDays : [],
      startDate,
      endDate,
      unitPrice: productView(product).price,
      totalPerDelivery: Math.round(productView(product).price * quantity * 100) / 100,
      status,
    };
  }

  const selectedAddress = req.user.addresses.id(req.body.addressId) || req.user.addresses.find((address) => address.isDefault) || req.user.addresses[0];
  const deliveryFee = subtotal ? 29 : 0;
  const total = Math.max(0, Math.round((subtotal + deliveryFee - couponDiscount) * 100) / 100);
  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      if (subscriptionData) {
        subscription = new Subscription(subscriptionData);
        await subscription.save({ session });
      }
      const [createdOrder] = await Order.create([{
        user: req.user._id,
        orderNumber: `AZ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        status: 'placed',
        items,
        addressSnapshot: selectedAddress ? selectedAddress.toObject() : null,
        couponCode: coupon?.code || '',
        subtotal: Math.round(subtotal * 100) / 100,
        productDiscount: Math.round(productDiscount * 100) / 100,
        couponDiscount,
        deliveryFee,
        total,
        subscription: subscription?._id || null,
        subscriptionSnapshot,
      }], { session });
      order = createdOrder;

      for (const item of items) {
        const stockUpdate = await Product.updateOne(
          { _id: item.product, active: true, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { session }
        );
        if (!stockUpdate.modifiedCount) throw Object.assign(new Error(`${item.name} no longer has enough stock.`), { status: 409 });
      }

      if (coupon) {
        const couponFilter = { _id: coupon._id, active: true };
        if (coupon.maxUses) couponFilter.usedCount = { $lt: coupon.maxUses };
        const couponUpdate = await Coupon.updateOne(couponFilter, { $inc: { usedCount: 1 } }, { session });
        if (!couponUpdate.modifiedCount) throw Object.assign(new Error('Coupon usage limit has been reached.'), { status: 409 });
      }
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ order, subscription: subscription ? subscriptionView(await subscription.populate('product')) : null });
}));

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (!file.mimetype.startsWith('image/')) return callback(new Error('Only image files are accepted.'));
    callback(null, true);
  },
});

app.post('/api/admin/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ email, role: 'admin', status: 'active' }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
    return res.status(401).json({ error: 'Admin email or password is incorrect.' });
  }
  res.json({ token: makeToken(user), user: cleanUser(user) });
}));

app.use('/api/admin', requireAuth('admin'));

app.get('/api/admin/dashboard', asyncHandler(async (_req, res) => {
  await refreshSubscriptionStatuses();
  const [users, products, subscriptions, orders, revenue, recentOrders, expiring] = await Promise.all([
    User.countDocuments({ role: 'customer', status: 'active' }),
    Product.countDocuments({ active: true }),
    Subscription.countDocuments({ status: 'active' }),
    Order.countDocuments({ status: { $ne: 'cancelled' } }),
    Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Order.find().sort({ createdAt: -1 }).limit(8).populate('user', 'name email'),
    Subscription.find({ status: { $in: ['active', 'scheduled'] } }).sort({ endDate: 1 }).limit(8).populate('user', 'name email').populate('product', 'name image'),
  ]);
  const expiredSubscriptions = await Subscription.countDocuments({ status: 'expired' });
  res.json({
    stats: { users, products, activeSubscriptions: subscriptions, expiredSubscriptions, orders, revenue: revenue[0]?.total || 0 },
    recentOrders,
    expiringSubscriptions: expiring.map(subscriptionView),
  });
}));

app.get('/api/admin/users', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const query = { role: 'customer' };
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];
  const users = await User.find(query).sort({ createdAt: -1 }).limit(500);
  res.json({ users: users.map(cleanUser) });
}));

app.patch('/api/admin/users/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'User not found.' });
  const user = await User.findOne({ _id: req.params.id, role: 'customer' });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (req.body.name !== undefined) user.name = String(req.body.name).trim();
  if (req.body.phone !== undefined) user.phone = String(req.body.phone).trim();
  if (['active', 'disabled'].includes(req.body.status)) user.status = req.body.status;
  await user.save();
  res.json({ user: cleanUser(user) });
}));

app.delete('/api/admin/users/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'User not found.' });
  const user = await User.findOneAndDelete({ _id: req.params.id, role: 'customer' });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  await Promise.all([
    Subscription.deleteMany({ user: user._id }),
    Order.deleteMany({ user: user._id }),
  ]);
  res.json({ ok: true });
}));

app.get('/api/admin/products', asyncHandler(async (_req, res) => {
  const products = await Product.find().sort({ updatedAt: -1 }).limit(500);
  res.json({ products: products.map(productView) });
}));

app.post('/api/admin/products', asyncHandler(async (req, res) => {
  const product = await Product.create(productBody(req.body));
  res.status(201).json({ product: productView(product) });
}));

app.patch('/api/admin/products/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
  const product = await Product.findByIdAndUpdate(req.params.id, productBody(req.body), { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product: productView(product) });
}));

app.delete('/api/admin/products/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found.' });
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  await Subscription.updateMany({ product: product._id, status: { $in: ['active', 'scheduled'] } }, {
    $set: { status: 'cancelled', endedAt: new Date(), endReason: 'product_deleted' },
  });
  res.json({ ok: true });
}));

app.post('/api/admin/images', upload.array('images', 8), asyncHandler(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Choose at least one image.' });
  const bucket = imageBucket();
  const images = await Promise.all(req.files.map((file) => new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(`${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(file.originalname)}`, {
      metadata: { contentType: file.mimetype },
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve({ id: String(stream.id), url: imageUrl(stream.id) }));
    stream.end(file.buffer);
  })));
  res.status(201).json({ images });
}));

app.get('/api/admin/orders', asyncHandler(async (_req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).limit(500).populate('user', 'name email phone');
  res.json({ orders });
}));

app.patch('/api/admin/orders/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id) || !['placed', 'processing', 'delivered', 'cancelled'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Invalid order update.' });
  }
  const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order });
}));

app.get('/api/admin/subscriptions', asyncHandler(async (_req, res) => {
  await refreshSubscriptionStatuses();
  const subscriptions = await Subscription.find().sort({ createdAt: -1 }).limit(1000).populate('user', 'name email phone').populate('product', 'name image unit price');
  res.json({ subscriptions: subscriptions.map(subscriptionView) });
}));

app.patch('/api/admin/subscriptions/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Subscription not found.' });
  const subscription = await Subscription.findById(req.params.id);
  if (!subscription) return res.status(404).json({ error: 'Subscription not found.' });
  if (req.body.endDate !== undefined) {
    const endDate = req.body.endDate ? new Date(req.body.endDate) : null;
    if (endDate && (!Number.isFinite(endDate.getTime()) || endDate < subscription.startDate)) return res.status(400).json({ error: 'End date must be after the start date.' });
    subscription.endDate = endDate;
  }
  if (['scheduled', 'active', 'expired', 'cancelled'].includes(req.body.status)) subscription.status = req.body.status;
  if (req.body.endReason !== undefined) subscription.endReason = String(req.body.endReason).slice(0, 200);
  await subscription.save();
  res.json({ subscription: subscriptionView(await subscription.populate(['user', 'product'])) });
}));

app.get('/api/admin/coupons', asyncHandler(async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).limit(500);
  res.json({ coupons });
}));

app.post('/api/admin/coupons', asyncHandler(async (req, res) => {
  const data = couponBody(req.body);
  if (!data.code || data.value <= 0) return res.status(400).json({ error: 'Coupon code and a positive discount value are required.' });
  const coupon = await Coupon.create(data);
  res.status(201).json({ coupon });
}));

app.patch('/api/admin/coupons/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Coupon not found.' });
  const data = couponBody(req.body);
  if (!data.code || data.value <= 0) return res.status(400).json({ error: 'Coupon code and a positive discount value are required.' });
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
  if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
  res.json({ coupon });
}));

app.delete('/api/admin/coupons/:id', asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Coupon not found.' });
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
  res.json({ ok: true });
}));

app.use('/admin', express.static(path.join(process.cwd(), 'public')));
app.get('/', (_req, res) => res.redirect('/admin/'));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
  if (error.name === 'ValidationError') return res.status(400).json({ error: error.message });
  if (error.code === 11000) return res.status(409).json({ error: 'That email, product slug, or coupon code is already in use.' });
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'The server could not complete that request.' : error.message });
});

async function seedDatabase() {
  const samples = [
    { name: 'Farm Fresh Cow Milk', slug: 'farm-fresh-cow-milk', category: 'Milk', description: 'Pure milk collected daily from local dairy farms.', unit: '1 L', price: 58, mrp: 62, stock: 120, image: '🥛', tags: ['fresh', 'milk'], rating: 4.8, discount: { kind: 'percentage', value: 6.45 }, active: true },
    { name: 'Premium Toned Milk', slug: 'premium-toned-milk', category: 'Milk', description: 'Low-fat, rich in nutrients and perfect for tea and coffee.', unit: '1 L', price: 62, mrp: 65, stock: 90, image: '🥛', tags: ['low fat'], rating: 4.7, active: true },
    { name: 'Homemade Curd', slug: 'homemade-curd', category: 'Curd', description: 'Smooth, creamy yogurt with a fresh homemade taste.', unit: '500 g', price: 46, mrp: 49, stock: 60, image: '🥣', tags: ['fresh'], rating: 4.9, active: true },
    { name: 'A2 Ghee', slug: 'a2-ghee', category: 'Ghee', description: 'Pure clarified butter with rich aroma and taste.', unit: '500 g', price: 390, mrp: 420, stock: 35, image: '🧈', tags: ['pure'], rating: 4.9, active: true },
    { name: 'Soft Paneer', slug: 'soft-paneer', category: 'Paneer', description: 'Fresh paneer made with hygienic, quality ingredients.', unit: '250 g', price: 140, mrp: 150, stock: 45, image: '🧀', tags: ['fresh'], rating: 4.8, active: true },
    { name: 'Kesar Peda', slug: 'kesar-peda', category: 'Sweets', description: 'Traditional Indian sweet prepared with saffron and milk.', unit: '250 g', price: 210, mrp: 225, stock: 28, image: '🍮', tags: ['popular'], rating: 4.7, active: true },
  ];
  for (const sample of samples) {
    await Product.updateOne({ slug: sample.slug }, { $setOnInsert: sample }, { upsert: true });
  }
  await Coupon.updateOne({ code: 'FRESH10' }, {
    $setOnInsert: { code: 'FRESH10', description: '10% off your first order', kind: 'percentage', value: 10, minimumOrder: 100, maximumDiscount: 150, maxUses: 0, active: true },
  }, { upsert: true });
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await User.updateOne(
      { email },
      { $setOnInsert: { name: 'Azad Dairy Admin', email, role: 'admin', status: 'active', passwordHash } },
      { upsert: true }
    );
  }
  console.log('Sample products and FRESH10 coupon are ready.');
}

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in admin-portal/.env or the deployment environment.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');
  await User.init();
  await Product.init();
  await Coupon.init();
  await Order.init();
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const existingAdmin = await User.findOne({ email });
    if (!existingAdmin) {
      await User.create({ name: 'Azad Dairy Admin', email, role: 'admin', passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) });
    } else if (existingAdmin.role !== 'admin') {
      throw new Error('ADMIN_EMAIL is already registered as a customer. Choose a separate administrator email.');
    }
  }
  if (process.argv.includes('--seed')) {
    await seedDatabase();
    await mongoose.disconnect();
    return;
  }
  app.listen(port, '0.0.0.0', () => console.log(`Azad Dairy Admin/API listening on ${port}`));
}

start().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
