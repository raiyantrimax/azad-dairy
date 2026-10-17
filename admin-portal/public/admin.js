(() => {
  const state = { token: '', user: null, products: [], users: [], orders: [], subscriptions: [], coupons: [], imageIds: [] };
  const titles = { dashboard: 'Store overview', users: 'Customers', products: 'Products', orders: 'Orders', subscriptions: 'Subscriptions', coupons: 'Coupons' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const date = (value) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const localInputDate = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const dateTimeInput = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };
  const statusPill = (value) => `<span class="status-pill ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;
  const emptyRow = (columns, message) => `<tr><td colspan="${columns}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.token) logout();
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }
    return payload;
  }

  function notice(message, error = false) {
    const element = $('#globalNotice');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => { element.hidden = true; }, 4200);
  }

  function setLoggedIn(user, token) {
    state.user = user;
    state.token = token;
    sessionStorage.setItem('azad-admin-token', token);
    $('#adminName').textContent = user.name || user.email;
    $('#loginView').hidden = true;
    $('#dashboardApp').hidden = false;
    showView('dashboard');
  }

  function logout() {
    state.token = '';
    state.user = null;
    sessionStorage.removeItem('azad-admin-token');
    $('#dashboardApp').hidden = true;
    $('#loginView').hidden = false;
  }

  async function login(event) {
    event.preventDefault();
    $('#loginError').textContent = '';
    const form = new FormData(event.currentTarget);
    try {
      const result = await request('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      setLoggedIn(result.user, result.token);
    } catch (error) {
      $('#loginError').textContent = error.message;
    }
  }

  function showView(name) {
    $$('.view-section').forEach((section) => { section.hidden = section.id !== `view-${name}`; });
    $$('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    $('#pageTitle').textContent = titles[name] || 'Store overview';
    $('#breadcrumb').textContent = (name || 'dashboard').toUpperCase();
    loadView(name).catch((error) => notice(error.message, true));
  }

  async function loadView(name) {
    if (name === 'dashboard') return loadDashboard();
    if (name === 'users') return loadUsers();
    if (name === 'products') return loadProducts();
    if (name === 'orders') return loadOrders();
    if (name === 'subscriptions') return loadSubscriptions();
    if (name === 'coupons') return loadCoupons();
  }

  async function loadDashboard() {
    const result = await request('/api/admin/dashboard');
    const stats = result.stats;
    $('#statRevenue').textContent = money(stats.revenue);
    $('#statOrders').textContent = stats.orders.toLocaleString('en-IN');
    $('#statUsers').textContent = stats.users.toLocaleString('en-IN');
    $('#statActiveSubs').textContent = stats.activeSubscriptions.toLocaleString('en-IN');
    $('#statExpiredSubs').textContent = stats.expiredSubscriptions.toLocaleString('en-IN');
    $('#recentOrders').innerHTML = result.recentOrders.length ? result.recentOrders.map((order) => `
      <div class="compact-row"><div><strong>${escapeHtml(order.orderNumber)}</strong><small>${escapeHtml(order.user?.name || 'Customer')} · ${date(order.createdAt)}</small></div><span class="compact-value">${money(order.total)}</span></div>
    `).join('') : '<div class="empty-state">No orders yet. Orders placed in the app will appear here.</div>';
    $('#subscriptionWatch').innerHTML = result.expiringSubscriptions.length ? result.expiringSubscriptions.map((subscription) => `
      <div class="compact-row"><div><strong>${escapeHtml(subscription.product?.name || 'Product')} · ${escapeHtml(subscription.plan)}</strong><small>${escapeHtml(subscription.userName || 'Customer')} · Ends ${date(subscription.endDate)}</small></div>${statusPill(subscription.status)}</div>
    `).join('') : '<div class="empty-state">No active or scheduled subscriptions.</div>';
  }

  async function loadUsers(search = '') {
    const result = await request(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    state.users = result.users;
    $('#usersTable').innerHTML = state.users.length ? state.users.map((user) => `
      <tr>
        <td><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></td>
        <td>${escapeHtml(user.phone || '—')}</td>
        <td>${user.addresses?.length || 0}</td>
        <td>${date(user.createdAt)}</td>
        <td>${statusPill(user.status)}</td>
        <td><div class="table-actions"><button class="action-button" data-edit-user="${escapeHtml(user.id)}">Edit</button><button class="action-button danger" data-delete-user="${escapeHtml(user.id)}">Delete</button></div></td>
      </tr>
    `).join('') : emptyRow(6, 'No customers match this search.');
  }

  async function loadProducts() {
    const result = await request('/api/admin/products');
    state.products = result.products;
    $('#productsTable').innerHTML = state.products.length ? state.products.map((product) => {
      const image = product.images?.[0] ? `<img src="${escapeHtml(product.images[0])}" alt="">` : escapeHtml(product.image || '🥛');
      const discount = Number(product.discount?.value || 0);
      const discountLabel = discount ? `${discount}${product.discount.kind === 'percentage' ? '%' : '₹'} off` : '—';
      return `<tr>
        <td><div class="product-cell"><span class="product-thumb">${image}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.unit)} · ${product.subscriptionAllowed ? 'Subscription enabled' : 'One-time only'}</small></span></div></td>
        <td>${escapeHtml(product.category)}</td>
        <td><strong>${money(product.price)}</strong><small>MRP ${money(product.mrp)}</small></td>
        <td>${escapeHtml(discountLabel)}</td>
        <td>${Number(product.stock).toLocaleString('en-IN')}</td>
        <td>${statusPill(product.active ? 'active' : 'disabled')}</td>
        <td><div class="table-actions"><button class="action-button" data-edit-product="${escapeHtml(product.id)}">Edit</button><button class="action-button danger" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></td>
      </tr>`;
    }).join('') : emptyRow(7, 'No products yet. Add the first item to the catalog.');
  }

  async function loadOrders() {
    const result = await request('/api/admin/orders');
    state.orders = result.orders;
    $('#ordersTable').innerHTML = state.orders.length ? state.orders.map((order) => {
      const lines = (order.items || []).map((item) => `${item.name} × ${item.quantity}`).join(', ');
      const customer = order.user?.name || 'Customer';
      const address = order.addressSnapshot;
      const deliveryAddress = address
        ? [address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(', ')
        : 'No address saved';
      const statusOptions = ['placed', 'processing', 'delivered', 'cancelled'].map((status) => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('');
      return `<tr>
        <td><strong>${escapeHtml(order.orderNumber)}</strong><small>${escapeHtml(order.couponCode || 'No coupon')}</small></td>
        <td><strong>${escapeHtml(customer)}</strong><small>${escapeHtml(order.user?.email || '')}</small></td>
        <td>${date(order.createdAt)}</td>
        <td><small>${escapeHtml(lines || '—')}</small>${order.subscriptionSnapshot ? `<small>↻ ${escapeHtml(order.subscriptionSnapshot.productName)} · ${escapeHtml(order.subscriptionSnapshot.plan)}</small>` : ''}</td>
        <td><small>${escapeHtml(deliveryAddress)}</small></td>
        <td>${money(Number(order.productDiscount || 0) + Number(order.couponDiscount || 0))}</td>
        <td><strong>${money(order.total)}</strong></td>
        <td><select class="select-input" data-order-status="${escapeHtml(order._id)}">${statusOptions}</select></td>
      </tr>`;
    }).join('') : emptyRow(8, 'Orders placed by customers will appear here.');
  }

  async function loadSubscriptions() {
    const result = await request('/api/admin/subscriptions');
    state.subscriptions = result.subscriptions;
    renderSubscriptions();
  }

  function renderSubscriptions() {
    const filter = $('#subscriptionFilter').value;
    const list = state.subscriptions.filter((subscription) => filter === 'all' || subscription.status === filter);
    $('#subscriptionsTable').innerHTML = list.length ? list.map((subscription) => `
      <tr>
        <td><strong>${escapeHtml(subscription.userName || 'Customer')}</strong><small>${escapeHtml(subscription.userEmail || '')}</small></td>
        <td><strong>${escapeHtml(subscription.product?.name || 'Product')}</strong><small>${escapeHtml(subscription.product?.unit || '')}</small></td>
        <td>${escapeHtml(subscription.plan)}${subscription.deliveryDays?.length ? `<small>${escapeHtml(subscription.deliveryDays.join(', '))}</small>` : ''}</td>
        <td>${Number(subscription.quantity)}</td>
        <td>${date(subscription.startDate)}</td>
        <td>${date(subscription.endDate)}</td>
        <td>${statusPill(subscription.status)}</td>
        <td><div class="table-actions"><button class="action-button" data-edit-subscription="${escapeHtml(subscription.id)}">Edit</button></div></td>
      </tr>
    `).join('') : emptyRow(8, 'No subscriptions match this filter.');
  }

  async function loadCoupons() {
    const result = await request('/api/admin/coupons');
    state.coupons = result.coupons;
    $('#couponsTable').innerHTML = state.coupons.length ? state.coupons.map((coupon) => `
      <tr>
        <td><strong>${escapeHtml(coupon.code)}</strong><small>${escapeHtml(coupon.description || '')}</small></td>
        <td>${coupon.kind === 'percentage' ? `${Number(coupon.value)}%` : money(coupon.value)}${coupon.maximumDiscount ? `<small>Cap ${money(coupon.maximumDiscount)}</small>` : ''}</td>
        <td>${money(coupon.minimumOrder)}</td>
        <td>${Number(coupon.usedCount)} / ${coupon.maxUses ? Number(coupon.maxUses) : '∞'}</td>
        <td>${date(coupon.endsAt)}</td>
        <td>${statusPill(coupon.active ? 'active' : 'disabled')}</td>
        <td><div class="table-actions"><button class="action-button" data-edit-coupon="${escapeHtml(coupon._id)}">Edit</button><button class="action-button danger" data-delete-coupon="${escapeHtml(coupon._id)}">Delete</button></div></td>
      </tr>
    `).join('') : emptyRow(7, 'No coupons yet. Add a promotion code.');
  }

  function openProductDialog(product) {
    const form = $('#productForm');
    form.reset();
    state.imageIds = product?.imageIds ? [...product.imageIds] : [];
    $('#productDialogTitle').textContent = product ? 'Edit product' : 'Add product';
    $('#productFormError').textContent = '';
    form.elements.id.value = product?.id || '';
    form.elements.name.value = product?.name || '';
    form.elements.slug.value = product?.slug || '';
    form.elements.category.value = product?.category || '';
    form.elements.unit.value = product?.unit || '';
    form.elements.price.value = product?.originalPrice ?? product?.price ?? '';
    form.elements.mrp.value = product?.mrp ?? product?.originalPrice ?? product?.price ?? '';
    form.elements.stock.value = product?.stock ?? 0;
    form.elements.rating.value = product?.rating ?? 0;
    form.elements.description.value = product?.description || '';
    form.elements.image.value = product?.image || '🥛';
    form.elements.tags.value = product?.tags?.join(', ') || '';
    form.elements.discountKind.value = product?.discount?.kind || 'percentage';
    form.elements.discountValue.value = product?.discount?.value || 0;
    form.elements.discountStartsAt.value = dateTimeInput(product?.discount?.startsAt);
    form.elements.discountEndsAt.value = dateTimeInput(product?.discount?.endsAt);
    form.elements.subscriptionAllowed.checked = product?.subscriptionAllowed !== false;
    form.elements.active.checked = product?.active !== false;
    renderImagePreviews(product?.images || []);
    $('#productDialog').showModal();
  }

  function renderImagePreviews(urls) {
    $('#existingImages').innerHTML = urls.map((url, index) => `
      <span class="image-preview"><img src="${escapeHtml(url)}" alt="Product image ${index + 1}"><button type="button" data-remove-image="${index}" aria-label="Remove image">×</button></span>
    `).join('');
  }

  function openCouponDialog(coupon) {
    const form = $('#couponForm');
    form.reset();
    $('#couponDialogTitle').textContent = coupon ? 'Edit coupon' : 'Add coupon';
    $('#couponFormError').textContent = '';
    form.elements.id.value = coupon?._id || '';
    form.elements.code.value = coupon?.code || '';
    form.elements.description.value = coupon?.description || '';
    form.elements.kind.value = coupon?.kind || 'percentage';
    form.elements.value.value = coupon?.value ?? '';
    form.elements.minimumOrder.value = coupon?.minimumOrder ?? 0;
    form.elements.maximumDiscount.value = coupon?.maximumDiscount ?? 0;
    form.elements.startsAt.value = dateTimeInput(coupon?.startsAt);
    form.elements.endsAt.value = dateTimeInput(coupon?.endsAt);
    form.elements.maxUses.value = coupon?.maxUses ?? 0;
    form.elements.productIds.value = coupon?.productIds?.join(', ') || '';
    form.elements.active.checked = coupon?.active !== false;
    $('#couponDialog').showModal();
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('#productFormError');
    error.textContent = '';
    const fields = new FormData(form);
    try {
      const files = [...form.elements.images.files];
      if (files.length) {
        const uploadData = new FormData();
        files.forEach((file) => uploadData.append('images', file));
        const uploaded = await request('/api/admin/images', { method: 'POST', body: uploadData });
        state.imageIds.push(...uploaded.images.map((image) => image.id));
      }
      const payload = {
        name: fields.get('name'), slug: fields.get('slug'), category: fields.get('category'), unit: fields.get('unit'),
        price: Number(fields.get('price')), mrp: Number(fields.get('mrp')), stock: Number(fields.get('stock')),
        rating: Number(fields.get('rating')), description: fields.get('description'), image: fields.get('image'),
        tags: String(fields.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
        images: state.imageIds, subscriptionAllowed: form.elements.subscriptionAllowed.checked,
        active: form.elements.active.checked,
        discount: {
          kind: fields.get('discountKind'), value: Number(fields.get('discountValue')),
          startsAt: fields.get('discountStartsAt') || null, endsAt: fields.get('discountEndsAt') || null,
        },
      };
      const id = fields.get('id');
      await request(id ? `/api/admin/products/${id}` : '/api/admin/products', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      $('#productDialog').close();
      notice(id ? 'Product updated.' : 'Product created.');
      await loadProducts();
    } catch (caught) {
      error.textContent = caught.message;
    }
  }

  async function saveCoupon(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const id = fields.get('id');
    const payload = {
      code: fields.get('code'), description: fields.get('description'), kind: fields.get('kind'), value: Number(fields.get('value')),
      minimumOrder: Number(fields.get('minimumOrder')), maximumDiscount: Number(fields.get('maximumDiscount')),
      startsAt: fields.get('startsAt') || null, endsAt: fields.get('endsAt') || null, maxUses: Number(fields.get('maxUses')),
      productIds: String(fields.get('productIds') || '').split(',').map((value) => value.trim()).filter(Boolean),
      active: form.elements.active.checked,
    };
    try {
      await request(id ? `/api/admin/coupons/${id}` : '/api/admin/coupons', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      $('#couponDialog').close();
      notice(id ? 'Coupon updated.' : 'Coupon created.');
      await loadCoupons();
    } catch (error) {
      $('#couponFormError').textContent = error.message;
    }
  }

  function openUserDialog(user) {
    const form = $('#userForm');
    form.reset();
    $('#userFormError').textContent = '';
    form.elements.id.value = user.id;
    form.elements.name.value = user.name;
    form.elements.phone.value = user.phone || '';
    form.elements.status.value = user.status;
    $('#userDialog').showModal();
  }

  async function saveUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const id = fields.get('id');
    try {
      await request(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: fields.get('name'), phone: fields.get('phone'), status: fields.get('status') }),
      });
      $('#userDialog').close();
      notice('Customer updated.');
      await loadUsers($('#userSearch').value.trim());
    } catch (error) {
      $('#userFormError').textContent = error.message;
    }
  }

  function openSubscriptionDialog(subscription) {
    const form = $('#subscriptionForm');
    form.reset();
    $('#subscriptionFormError').textContent = '';
    form.elements.id.value = subscription.id;
    form.elements.endDate.value = localInputDate(subscription.endDate);
    form.elements.status.value = subscription.status;
    $('#subscriptionDialog').showModal();
  }

  async function saveSubscription(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const id = fields.get('id');
    try {
      await request(`/api/admin/subscriptions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ endDate: fields.get('endDate') || null, status: fields.get('status') }),
      });
      $('#subscriptionDialog').close();
      notice('Subscription updated.');
      await loadSubscriptions();
    } catch (error) {
      $('#subscriptionFormError').textContent = error.message;
    }
  }

  async function onTableClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.editUser) {
      const user = state.users.find((item) => item.id === button.dataset.editUser);
      if (user) openUserDialog(user);
    }
    if (button.dataset.deleteUser) {
      if (!confirm('Delete this customer and their order and subscription records? This cannot be undone.')) return;
      try { await request(`/api/admin/users/${button.dataset.deleteUser}`, { method: 'DELETE' }); notice('Customer deleted.'); await loadUsers($('#userSearch').value.trim()); }
      catch (error) { notice(error.message, true); }
    }
    if (button.dataset.editProduct) {
      const product = state.products.find((item) => item.id === button.dataset.editProduct);
      if (product) openProductDialog(product);
    }
    if (button.dataset.deleteProduct) {
      if (!confirm('Delete this product? Active subscriptions for it will be cancelled.')) return;
      try { await request(`/api/admin/products/${button.dataset.deleteProduct}`, { method: 'DELETE' }); notice('Product deleted.'); await loadProducts(); }
      catch (error) { notice(error.message, true); }
    }
    if (button.dataset.editCoupon) {
      const coupon = state.coupons.find((item) => item._id === button.dataset.editCoupon);
      if (coupon) openCouponDialog(coupon);
    }
    if (button.dataset.deleteCoupon) {
      if (!confirm('Delete this coupon?')) return;
      try { await request(`/api/admin/coupons/${button.dataset.deleteCoupon}`, { method: 'DELETE' }); notice('Coupon deleted.'); await loadCoupons(); }
      catch (error) { notice(error.message, true); }
    }
    if (button.dataset.editSubscription) {
      const subscription = state.subscriptions.find((item) => item.id === button.dataset.editSubscription);
      if (subscription) openSubscriptionDialog(subscription);
    }
    if (button.dataset.removeImage !== undefined) {
      const index = Number(button.dataset.removeImage);
      state.imageIds.splice(index, 1);
      const product = state.products.find((item) => item.id === $('#productForm').elements.id.value);
      renderImagePreviews(state.imageIds.map((id) => `/api/images/${id}`));
      void product;
    }
  }

  async function updateOrderStatus(event) {
    const select = event.target.closest('[data-order-status]');
    if (!select) return;
    try {
      await request(`/api/admin/orders/${select.dataset.orderStatus}`, {
        method: 'PATCH', body: JSON.stringify({ status: select.value }),
      });
      notice('Order status updated.');
    } catch (error) {
      notice(error.message, true);
      await loadOrders();
    }
  }

  $('#loginForm').addEventListener('submit', login);
  $('#logoutButton').addEventListener('click', logout);
  $('#refreshButton').addEventListener('click', () => loadView($$('.nav-link.active')[0]?.dataset.view || 'dashboard').catch((error) => notice(error.message, true)));
  $('#addProductButton').addEventListener('click', () => openProductDialog(null));
  $('#addCouponButton').addEventListener('click', () => openCouponDialog(null));
  $('#productForm').addEventListener('submit', saveProduct);
  $('#couponForm').addEventListener('submit', saveCoupon);
  $('#userForm').addEventListener('submit', saveUser);
  $('#subscriptionForm').addEventListener('submit', saveSubscription);
  $('#usersTable').addEventListener('click', onTableClick);
  $('#productsTable').addEventListener('click', onTableClick);
  $('#ordersTable').addEventListener('change', updateOrderStatus);
  $('#subscriptionsTable').addEventListener('click', onTableClick);
  $('#couponsTable').addEventListener('click', onTableClick);
  $('#existingImages').addEventListener('click', onTableClick);
  $('#subscriptionFilter').addEventListener('change', renderSubscriptions);
  $('#userSearch').addEventListener('input', () => {
    clearTimeout(loadUsers.timer);
    loadUsers.timer = setTimeout(() => loadUsers($('#userSearch').value.trim()).catch((error) => notice(error.message, true)), 220);
  });
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-goto]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.goto)));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));

  document.addEventListener('DOMContentLoaded', () => {
    const token = sessionStorage.getItem('azad-admin-token');
    if (!token) return;
    state.token = token;
    request('/api/auth/me').then(({ user }) => setLoggedIn(user, token)).catch(logout);
  });
})();
