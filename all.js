/**
 * ==========================================
 * Google Sheets API 與 應用程式核心邏輯
 * 
 * 請在此填寫您的 Client ID 與 Spreadsheet ID
 * ==========================================
 */

// TODO: 請填寫您的 Google OAuth 2.0 Client ID (從 GCP 取得)
const GOOGLE_CLIENT_ID = '603537949987-n4t7fe74rp1qvcnvij7kata7m9iik3he.apps.googleusercontent.com';

// TODO: 請填寫您的 Google Sheet ID (從試算表網址列取得 d/ 與 /edit 中間的字串)
const SPREADSHEET_ID = '1K7xcrOdd1WeseQy8P3AFCiB64IsaSRJpBgmz_5MOh9c';

// 需要的權限範圍 (讀寫試算表, 以及取得使用者 Email)
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';

// Google API URLs
const SHEET_API_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

// 應用程式全域狀態
const AppState = {
    accessToken: null,
    userEmail: null,
    userRole: null, // '管理員' | '一般成員' | null
    menuData: [], // 所有菜單
    todayRestaurants: [], // 今日選擇的餐廳
    todayMealType: '午餐', // 今日餐別
    usersData: {}, // Email -> Role 對應
    ordersData: [] // 今日訂單
};

// ==========================================
// DOM 元素選取
// ==========================================
const DOM = {
    loginBtn: document.getElementById('login-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    loginMsg: document.getElementById('login-msg'),

    sections: {
        login: document.getElementById('login-section'),
        admin: document.getElementById('admin-section'),
        order: document.getElementById('order-section'),
        ordersList: document.getElementById('orders-list-section')
    },

    admin: {
        mealType: document.getElementById('meal-type'),
        checkboxes: document.getElementById('restaurant-checkboxes'),
        saveBtn: document.getElementById('save-config-btn'),
        clearBtn: document.getElementById('clear-orders-btn'),
        msg: document.getElementById('admin-msg')
    },

    order: {
        userInfo: document.getElementById('user-info-text'),
        configInfo: document.getElementById('today-config-info'),
        menuGrid: document.getElementById('menu-container'),
        msg: document.getElementById('order-msg')
    },

    ordersList: {
        tbody: document.getElementById('orders-tbody'),
        tfoot: document.getElementById('orders-tfoot'),
        copyBtn: document.getElementById('copy-orders-btn')
    }
};

// ==========================================
// 初始化 Google Identity Services (GIS)
// ==========================================
let tokenClient;

window.onload = function () {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID')) {
        showMsg(DOM.loginMsg, '🚨 系統提示：請先至 all.js 設定正式的 Client ID 與 Spreadsheet ID。', 'error');
    }

    try {
        // 初始 Google Token Client
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleAuthResponse,
        });

        DOM.loginBtn.addEventListener('click', () => {
            // 觸發登入並請求 Token
            tokenClient.requestAccessToken({ prompt: 'consent' });
        });

        DOM.logoutBtn.addEventListener('click', handleLogout);
    } catch (error) {
        console.error("GIS 初始化失敗，請確認已連上網路或腳本正常載入", error);
    }

    bindEvents();
};

// ==========================================
// 綁定其他按鈕事件
// ==========================================
function bindEvents() {
    DOM.admin.saveBtn.addEventListener('click', handleSaveTodayConfig);
    DOM.admin.clearBtn.addEventListener('click', handleClearOrders);
    DOM.ordersList.copyBtn.addEventListener('click', handleCopyOrders);
}

// ==========================================
// 處理登入與 Token 回應
// ==========================================
async function handleAuthResponse(response) {
    if (response.error !== undefined) {
        showMsg(DOM.loginMsg, '登入失敗，請重試。', 'error');
        return;
    }

    showMsg(DOM.loginMsg, '登入成功！正為您讀取系統資料...', 'success');
    AppState.accessToken = response.access_token;

    try {
        // 取得使用者 Email
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${AppState.accessToken}` }
        });
        const userInfo = await userInfoRes.json();
        AppState.userEmail = userInfo.email;

        // 初始化載入所有必要表格資料
        await loadAllSheetData();

        // 檢查權限並切換畫面
        checkUserRoleAndSwitchView();

    } catch (error) {
        console.error('資料載入錯誤:', error);
        showMsg(DOM.loginMsg, '資料載入失敗，請確認試算表權限及 SPREADSHEET_ID 設置。', 'error');
    }
}

function handleLogout() {
    AppState.accessToken = null;
    AppState.userEmail = null;
    AppState.userRole = null;
    switchSection('login');
    showMsg(DOM.loginMsg, '您已登出。', 'success');
}

// ==========================================
// Google Sheets API 操作封裝
// ==========================================

// 一次性讀取多個工作表
async function loadAllSheetData() {
    const ranges = [
        'Users!A2:C',      // 取得使用者清單 (姓名, Email, 權限)
        'Menu!A2:D',       // 取得菜單 (餐廳名稱, 品名, 單價, 分類)
        'TodayConfig!A2:B',// 取得今日設定 (餐廳, 餐別)
        'Orders!A2:G'      // 取得現有訂單
    ];

    const url = `${SHEET_API_BASE}/values:batchGet?ranges=${ranges.join('&ranges=')}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${AppState.accessToken}` }
    });

    if (!response.ok) throw new Error('Failed to fetch sheets data');

    const data = await response.json();
    const valueRanges = data.valueRanges;

    // 解析 Users 資料
    const usersRows = valueRanges[0].values || [];
    AppState.usersData = {};
    usersRows.forEach(row => {
        if (row[1]) AppState.usersData[row[1].trim()] = row[2] ? row[2].trim() : '一般成員';
    });

    // 解析 Menu 資料
    AppState.menuData = (valueRanges[1].values || []).map(row => ({
        restaurant: row[0],
        name: row[1],
        price: row[2],
        category: row[3] || ''
    }));

    // 解析 TodayConfig 資料
    const configRows = valueRanges[2].values || [];
    AppState.todayRestaurants = configRows.map(row => row[0]).filter(r => r);
    AppState.todayMealType = configRows.length > 0 && configRows[0][1] ? configRows[0][1] : '午餐';

    // 解析 Orders 資料 (用於訂單確認區塊)
    AppState.ordersData = valueRanges[3].values || [];
}

// 附加資料至某範圍 (例如寫入訂單或今日設定)
async function appendSheetData(range, values) {
    const url = `${SHEET_API_BASE}/values/${range}:append?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${AppState.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: values })
    });
    if (!response.ok) throw new Error(`Append to ${range} failed`);
    return response.json();
}

// 清除某範圍資料
async function clearSheetData(range) {
    const url = `${SHEET_API_BASE}/values/${range}:clear`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AppState.accessToken}` }
    });
    if (!response.ok) throw new Error(`Clear ${range} failed`);
    return response.json();
}

// ==========================================
// 權限與畫面切換邏輯
// ==========================================

function checkUserRoleAndSwitchView() {
    const role = AppState.usersData[AppState.userEmail];

    if (!role) {
        showMsg(DOM.loginMsg, `未獲授權：您的 Email (${AppState.userEmail}) 不在使用者名單內。`, 'error');
        return;
    }

    AppState.userRole = role;
    DOM.order.userInfo.textContent = `👤 ${AppState.userEmail} (${role})`;

    // 初始化畫面
    if (role === '管理員') {
        DOM.sections.admin.classList.remove('hidden');
        renderAdminControls();
    } else {
        DOM.sections.admin.classList.add('hidden');
    }

    DOM.sections.order.classList.remove('hidden');
    DOM.sections.ordersList.classList.remove('hidden');

    renderOrderSection();
    renderOrdersTable();
    switchSection('main');
}

function switchSection(view) {
    if (view === 'login') {
        DOM.sections.login.classList.remove('hidden');
        DOM.sections.admin.classList.add('hidden');
        DOM.sections.order.classList.add('hidden');
        DOM.sections.ordersList.classList.add('hidden');
    } else {
        DOM.sections.login.classList.add('hidden');
    }
}

// ==========================================
// 管理員區塊邏輯
// ==========================================

function renderAdminControls() {
    // 取得所有不重複的餐廳清單
    const allRestaurants = [...new Set(AppState.menuData.map(m => m.restaurant))];

    DOM.admin.mealType.value = AppState.todayMealType;

    DOM.admin.checkboxes.innerHTML = allRestaurants.map(res => `
        <label class="checkbox-label">
            <input type="checkbox" value="${res}" ${AppState.todayRestaurants.includes(res) ? 'checked' : ''}>
            ${res}
        </label>
    `).join('');
}

async function handleSaveTodayConfig() {
    const selectedCheckboxes = DOM.admin.checkboxes.querySelectorAll('input:checked');
    const selectedRestaurants = Array.from(selectedCheckboxes).map(cb => cb.value);
    const mealType = DOM.admin.mealType.value;

    if (selectedRestaurants.length === 0) {
        showMsg(DOM.admin.msg, '請至少選擇一間餐廳！', 'error');
        return;
    }

    DOM.admin.saveBtn.disabled = true;
    DOM.admin.saveBtn.textContent = '儲存中...';

    try {
        // 先清空原有的 TodayConfig
        await clearSheetData('TodayConfig!A2:B');

        // 準備新資料，第一列包含餐別，後續的列如果還有其他餐廳則餐別留空或重複皆可，這裡每列都寫
        const values = selectedRestaurants.map(res => [res, mealType]);
        await appendSheetData('TodayConfig!A:B', values);

        // 更新本地 State
        AppState.todayRestaurants = selectedRestaurants;
        AppState.todayMealType = mealType;

        showMsg(DOM.admin.msg, '今日設定儲存成功！', 'success');

        // 重新渲染點餐畫面
        renderOrderSection();

    } catch (error) {
        console.error(error);
        showMsg(DOM.admin.msg, '儲存失敗，請重試。', 'error');
    } finally {
        DOM.admin.saveBtn.disabled = false;
        DOM.admin.saveBtn.textContent = '儲存今日設定';
    }
}

async function handleClearOrders() {
    if (!confirm('🚨 確定要清空今日所有的點餐紀錄嗎？此動作無法復原！')) return;

    DOM.admin.clearBtn.disabled = true;
    DOM.admin.clearBtn.textContent = '清空中...';

    try {
        // 清空 Orders 標題列以外的資料 (A2 之後)
        await clearSheetData('Orders!A2:G');

        // 同步清空本地狀態並重新渲染
        AppState.ordersData = [];
        renderOrdersTable();

        showMsg(DOM.admin.msg, '今日訂單已清除完畢！', 'success');
    } catch (error) {
        console.error(error);
        showMsg(DOM.admin.msg, '清除失敗，請檢察連線或權限。', 'error');
    } finally {
        DOM.admin.clearBtn.disabled = false;
        DOM.admin.clearBtn.textContent = '清空今日點餐紀錄';
    }
}

// ==========================================
// 使用者點餐區塊邏輯
// ==========================================

function renderOrderSection() {
    DOM.order.configInfo.innerHTML = `🛒 目前餐別：<strong>${AppState.todayMealType}</strong><br>🍽️ 今日開放餐廳：<strong>${AppState.todayRestaurants.join(', ') || '尚未設定'}</strong>`;

    if (AppState.todayRestaurants.length === 0) {
        DOM.order.menuGrid.innerHTML = '<p class="msg-text msg-error">管理員尚未設定今日餐廳，請稍候再來看看喔！</p>';
        return;
    }

    // 過濾出屬於今日餐廳的菜單
    const todayMenu = AppState.menuData.filter(m => AppState.todayRestaurants.includes(m.restaurant));

    if (todayMenu.length === 0) {
        DOM.order.menuGrid.innerHTML = '<p class="msg-text msg-error">找不到符合的餐點資料。</p>';
        return;
    }

    DOM.order.menuGrid.innerHTML = todayMenu.map((m, index) => `
        <div class="menu-card">
            <span class="meal-res">${m.restaurant}</span>
            <div class="meal-name">${m.name}</div>
            ${m.category ? `<span class="meal-category">${m.category}</span>` : ''}
            <div class="meal-price">$${m.price}</div>
            <div class="meal-action">
                <input type="text" id="note-${index}" class="form-control" placeholder="備註 (如：去冰半糖)">
                <button class="btn btn-primary" onclick="submitOrder('${m.restaurant}', '${m.name}', ${m.price}, ${index})">點此餐點</button>
            </div>
        </div>
    `).join('');
}

async function submitOrder(restaurant, mealName, price, index) {
    const noteInput = document.getElementById(`note-${index}`);
    const note = noteInput.value.trim();

    // 取得當下時間格式：YYYY/MM/DD HH:mm
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 格式: [點餐時間, 訂購人 Email, 餐別, 餐廳名稱, 餐點內容, 金額, 備註]
    const orderData = [
        timeStr,
        AppState.userEmail,
        AppState.todayMealType,
        restaurant,
        mealName,
        price,
        note
    ];

    try {
        await appendSheetData('Orders!A:G', [orderData]);
        showMsg(DOM.order.msg, `✅ 成功點餐：${mealName}！`, 'success');
        noteInput.value = ''; // 清空輸入框

        // 將新訂單加入本地狀態並更新表格
        AppState.ordersData.push(orderData);
        renderOrdersTable();

        // 3 秒後清除提示
        setTimeout(() => { DOM.order.msg.textContent = ''; }, 3000);
    } catch (error) {
        console.error(error);
        showMsg(DOM.order.msg, '點餐失敗，請確認網路連線。', 'error');
    }
}

// ==========================================
// 訂單確認區塊邏輯
// ==========================================

function renderOrdersTable() {
    if (AppState.ordersData.length === 0) {
        DOM.ordersList.tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">目前尚無訂單</td></tr>';
        DOM.ordersList.tfoot.innerHTML = '';
        return;
    }

    let totalAmount = 0;

    DOM.ordersList.tbody.innerHTML = AppState.ordersData.map(row => {
        let price = parseInt(row[5], 10);
        if (!isNaN(price)) totalAmount += price;
        return `
        <tr>
            <td>${row[1] || ''}</td>
            <td>${row[2] || ''}</td>
            <td>${row[3] || ''}</td>
            <td>${row[4] || ''}</td>
            <td>${row[5] || ''}</td>
            <td>${row[6] || ''}</td>
        </tr>
    `}).join('');

    DOM.ordersList.tfoot.innerHTML = `
        <tr style="font-weight: bold; background-color: #fff3e0;">
            <td colspan="4" style="text-align: right;">金額合計：</td>
            <td colspan="2" style="color: var(--danger-color); font-size: 18px;">$${totalAmount}</td>
        </tr>
    `;
}

function handleCopyOrders() {
    if (AppState.ordersData.length === 0) {
        alert('目前無訂單可複製');
        return;
    }

    // 組織文字供 LINE 使用
    let text = `📋 【今日點餐統計】 - ${AppState.todayMealType}\n`;
    text += `--------------------------\n`;

    AppState.ordersData.forEach(row => {
        const email = row[1] ? row[1].split('@')[0] : '未知';
        const res = row[3] || '';
        const meal = row[4] || '';
        const price = row[5] || '';
        const note = row[6] ? `(${row[6]})` : '';
        text += `- ${email}: [${res}] ${meal} $${price} ${note}\n`;
    });

    // 計算總金額
    let total = 0;
    AppState.ordersData.forEach(row => {
        const val = parseInt(row[5], 10);
        if (!isNaN(val)) total += val;
    });
    text += `--------------------------\n`;
    text += `💰 總金額：$${total}`;

    navigator.clipboard.writeText(text).then(() => {
        alert('✅ 已複製訂單明細，可直接貼上至 LINE 群組！');
    }).catch(err => {
        console.error('複製失敗', err);
        alert('請手動複製！');
    });
}

// ==========================================
// 輔助函式
// ==========================================
function showMsg(element, msg, type) {
    element.textContent = msg;
    element.className = 'msg-text'; // reset
    if (type === 'success') element.classList.add('msg-success');
    if (type === 'error') element.classList.add('msg-error');
}
