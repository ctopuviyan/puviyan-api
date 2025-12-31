// API Configuration
let API_BASE_URL = 'http://localhost:8080/api/v1';
let PARTNER_API_KEY = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load saved config
    const savedUrl = localStorage.getItem('apiBaseUrl');
    const savedKey = localStorage.getItem('partnerApiKey');
    
    if (savedUrl) {
        document.getElementById('apiBaseUrl').value = savedUrl;
        API_BASE_URL = savedUrl;
    }
    
    if (savedKey) {
        document.getElementById('partnerApiKey').value = savedKey;
        PARTNER_API_KEY = savedKey;
    }
    
    // Save config on change
    document.getElementById('apiBaseUrl').addEventListener('change', (e) => {
        API_BASE_URL = e.target.value;
        localStorage.setItem('apiBaseUrl', API_BASE_URL);
    });
    
    document.getElementById('partnerApiKey').addEventListener('change', (e) => {
        PARTNER_API_KEY = e.target.value;
        localStorage.setItem('partnerApiKey', PARTNER_API_KEY);
    });
    
    // Set default dates for reward form
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    document.querySelector('input[name="validFrom"]').value = formatDateTimeLocal(tomorrow);
    document.querySelector('input[name="validTo"]').value = formatDateTimeLocal(nextMonth);
    
    // Setup form handlers
    setupFormHandlers();
});

function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Tab switching
function switchTab(tabName, event) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Activate button
    if (event && event.target) {
        event.target.classList.add('active');
    }
}

// Reward type selection
function selectRewardType(type) {
    // Update hidden input
    document.getElementById('rewardType').value = type;
    
    // Update button states
    document.querySelectorAll('.reward-type-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.reward-type-btn').classList.add('active');
    
    // Show/hide type-specific fields
    document.querySelectorAll('.type-specific-fields').forEach(field => {
        field.classList.remove('active');
    });
    document.getElementById(`${type}-fields`).classList.add('active');
}

// Setup form handlers
function setupFormHandlers() {
    // Partner form
    document.getElementById('partnerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createPartner(new FormData(e.target));
    });
    
    // Reward form
    document.getElementById('rewardForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createReward(new FormData(e.target));
    });
    
    // Browse form
    document.getElementById('browseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await browseRewards(new FormData(e.target));
    });
    
    // Reserve form
    document.getElementById('reserveForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await reserveReward(new FormData(e.target));
    });
    
    // Scan form
    document.getElementById('scanForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await scanQR(new FormData(e.target));
    });
    
    // Confirm form
    document.getElementById('confirmForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await confirmRedemption(new FormData(e.target));
    });
}

// Show response
function showResponse(elementId, data, isError = false) {
    const element = document.getElementById(elementId);
    element.className = 'response-box show ' + (isError ? 'error' : 'success');
    element.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// API Functions

async function createPartner(formData) {
    try {
        const data = {
            name: formData.get('name'),
            brandName: formData.get('brandName'),
            contactInfo: {
                email: formData.get('email'),
                phone: formData.get('phone') || ''
            },
            categories: formData.get('categories') ? 
                formData.get('categories').split(',').map(c => c.trim()) : [],
            isActive: true
        };
        
        const response = await fetch(`${API_BASE_URL}/admin/partners`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showResponse('partnerResponse', result);
            
            // Auto-fill partner API key
            if (result.apiKey) {
                document.getElementById('partnerApiKey').value = result.apiKey;
                PARTNER_API_KEY = result.apiKey;
                localStorage.setItem('partnerApiKey', result.apiKey);
                alert('✅ Partner created! API key has been saved automatically.');
            }
        } else {
            showResponse('partnerResponse', result, true);
        }
    } catch (error) {
        showResponse('partnerResponse', { error: error.message }, true);
    }
}

async function createReward(formData) {
    try {
        const rewardType = formData.get('rewardType');
        
        const data = {
            rewardTitle: formData.get('rewardTitle'),
            rewardSubtitle: formData.get('rewardSubtitle') || '',
            rewardType: rewardType,
            brandName: formData.get('brandName'),
            deductPoints: parseInt(formData.get('deductPoints')),
            maxPerUser: parseInt(formData.get('maxPerUser')),
            validFrom: new Date(formData.get('validFrom')).toISOString(),
            validTo: new Date(formData.get('validTo')).toISOString(),
            status: formData.get('status'),
            categories: formData.get('categories') ? 
                formData.get('categories').split(',').map(c => c.trim()) : []
        };
        
        // Add orgId if provided
        const orgId = formData.get('orgId');
        if (orgId && orgId.trim()) {
            data.orgId = orgId.trim();
        }
        
        // Add type-specific fields
        if (rewardType === 'coupon') {
            data.totalCoupons = parseInt(formData.get('totalCoupons'));
        } else if (rewardType === 'percent_off') {
            data.discountPercent = parseInt(formData.get('discountPercent'));
            if (formData.get('maxDiscountAmount')) {
                data.maxDiscountAmount = parseInt(formData.get('maxDiscountAmount'));
            }
            if (formData.get('minPurchaseAmount')) {
                data.minPurchaseAmount = parseInt(formData.get('minPurchaseAmount'));
            }
        } else if (rewardType === 'amount_off') {
            data.discountAmount = parseInt(formData.get('discountAmount'));
            if (formData.get('minPurchaseAmount')) {
                data.minPurchaseAmount = parseInt(formData.get('minPurchaseAmount'));
            }
        }
        
        const response = await fetch(`${API_BASE_URL}/rewards-management`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showResponse('rewardResponse', result);
            alert('✅ Reward created! Copy the rewardId for testing.');
        } else {
            showResponse('rewardResponse', result, true);
        }
    } catch (error) {
        showResponse('rewardResponse', { error: error.message }, true);
    }
}

async function browseRewards(formData) {
    try {
        const userId = formData ? formData.get('userId') : '';
        let url = `${API_BASE_URL}/rewards-management`;
        
        // Add userId query param if provided
        if (userId && userId.trim()) {
            url += `?userId=${encodeURIComponent(userId.trim())}`;
        }
        
        const response = await fetch(url);
        const result = await response.json();
        
        if (response.ok) {
            showResponse('browseResponse', result);
        } else {
            showResponse('browseResponse', result, true);
        }
    } catch (error) {
        showResponse('browseResponse', { error: error.message }, true);
    }
}

async function reserveReward(formData) {
    try {
        const data = {
            rewardId: formData.get('rewardId'),
            userId: formData.get('userId')
        };
        
        const response = await fetch(`${API_BASE_URL}/rewards/reserve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showResponse('reserveResponse', result);
            
            // Display QR code
            if (result.qrToken) {
                document.getElementById('qrDisplay').style.display = 'block';
                document.getElementById('qrToken').value = result.qrToken;
                
                // Generate QR code image
                const qrContainer = document.getElementById('qrCode');
                qrContainer.innerHTML = '';
                QRCode.toCanvas(result.qrToken, { width: 300 }, (error, canvas) => {
                    if (error) {
                        qrContainer.innerHTML = '<p style="color: red;">Error generating QR code</p>';
                    } else {
                        qrContainer.appendChild(canvas);
                    }
                });
                
                alert('✅ Reward reserved! Scroll down to see the QR code.');
            }
        } else {
            showResponse('reserveResponse', result, true);
        }
    } catch (error) {
        showResponse('reserveResponse', { error: error.message }, true);
    }
}

async function scanQR(formData) {
    try {
        if (!PARTNER_API_KEY) {
            alert('⚠️ Please set Partner API Key in the configuration section first!');
            return;
        }
        
        const data = {
            qrToken: formData.get('qrToken').trim()
        };
        
        const response = await fetch(`${API_BASE_URL}/redemption/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-partner-api-key': PARTNER_API_KEY
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showResponse('scanResponse', result);
            
            // Auto-fill confirm form
            if (result.redemptionId && result.user?.userId) {
                document.querySelector('#confirmForm input[name="redemptionId"]').value = result.redemptionId;
                document.querySelector('#confirmForm input[name="userId"]').value = result.user.userId;
                alert('✅ QR scanned! Redemption details have been auto-filled in the Confirm tab.');
            }
        } else {
            showResponse('scanResponse', result, true);
        }
    } catch (error) {
        showResponse('scanResponse', { error: error.message }, true);
    }
}

async function confirmRedemption(formData) {
    try {
        if (!PARTNER_API_KEY) {
            alert('⚠️ Please set Partner API Key in the configuration section first!');
            return;
        }
        
        const data = {
            redemptionId: formData.get('redemptionId'),
            userId: formData.get('userId')
        };
        
        // Add optional fields if provided
        if (formData.get('billAmount')) {
            data.billAmount = parseInt(formData.get('billAmount'));
        }
        if (formData.get('appliedDiscount')) {
            data.appliedDiscount = parseInt(formData.get('appliedDiscount'));
        }
        
        const response = await fetch(`${API_BASE_URL}/redemption/confirm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-partner-api-key': PARTNER_API_KEY
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showResponse('confirmResponse', result);
            alert('✅ Redemption confirmed! Points have been deducted from user.');
        } else {
            showResponse('confirmResponse', result, true);
        }
    } catch (error) {
        showResponse('confirmResponse', { error: error.message }, true);
    }
}
