const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: true,
  credentials: true
}));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'super-geheim-2025',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Configuration
const CONFIG = {
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  EMAIL_TO: process.env.EMAIL_TO
};

// Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: CONFIG.EMAIL_USER,
    pass: CONFIG.EMAIL_PASS
  }
});

// ========== ROUTES ==========

// Discord Login
app.get('/api/auth/login', (req, res) => {
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20email`;
  res.redirect(discordAuthUrl);
});

// Discord Callback
app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    console.log('❌ No authorization code received');
    return res.redirect('/?error=no_code');
  }

  try {
    // Get access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: CONFIG.DISCORD_CLIENT_ID,
        client_secret: CONFIG.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: CONFIG.DISCORD_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.log('❌ No access token received:', tokenData);
      return res.redirect('/?error=no_token');
    }

    // Get user data
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    const userData = await userResponse.json();
    console.log('✅ User authenticated:', userData.username);

    // Save to session
    req.session.user = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator || '0',
      avatar: userData.avatar 
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` 
        : 'https://cdn.discordapp.com/embed/avatars/0.png',
      email: userData.email
    };

    // Force save session before redirect
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session save error:', err);
        return res.redirect('/?error=session_error');
      }
      console.log('💾 Session saved successfully');
      res.redirect('/?login=success');
    });

  } catch (error) {
    console.error('❌ Auth error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// Check if user is logged in
app.get('/api/auth/user', (req, res) => {
  if (req.session && req.session.user) {
    console.log('✅ User session found:', req.session.user.username);
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    console.log('❌ No user session');
    res.json({ loggedIn: false });
  }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// Submit Order
app.post('/api/order', async (req, res) => {
  if (!req.session || !req.session.user) {
    console.log('❌ Order attempt without login');
    return res.status(401).json({ error: 'Nicht eingeloggt' });
  }

  const { botFeatures, botLogo, additionalMessage } = req.body;

  if (!botFeatures || !botFeatures.trim()) {
    return res.status(400).json({ error: 'Bot-Features sind erforderlich' });
  }

  const user = req.session.user;
  const orderData = {
    discordUsername: `${user.username}#${user.discriminator}`,
    discordId: user.id,
    email: user.email || 'Keine Email angegeben',
    botFeatures: botFeatures,
    additionalMessage: additionalMessage || 'Keine zusätzliche Nachricht',
    hasLogo: !!botLogo,
    timestamp: new Date().toISOString()
  };

  try {
    const attachments = [];
    
    // Handle logo if provided
    if (botLogo) {
      try {
        const base64Data = botLogo.split(',')[1];
        const mimeType = botLogo.split(';')[0].split(':')[1];
        const extension = mimeType.split('/')[1];
        
        attachments.push({
          filename: `bot-logo.${extension}`,
          content: base64Data,
          encoding: 'base64'
        });
      } catch (err) {
        console.error('Logo processing error:', err);
      }
    }

    // Send email
    const mailOptions = {
      from: CONFIG.EMAIL_USER,
      to: CONFIG.EMAIL_TO,
      subject: `🤖 Neue Bot-Bestellung von ${orderData.discordUsername}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              max-width: 700px;
              margin: 0 auto;
              padding: 20px;
            }
            .header { 
              background: linear-gradient(135deg, #5865F2, #7289DA); 
              color: white; 
              padding: 30px; 
              text-align: center; 
              border-radius: 10px;
              margin-bottom: 20px;
            }
            .content { 
              background: #f9f9f9; 
              padding: 30px; 
              border-radius: 10px; 
            }
            .info-box { 
              background: white; 
              padding: 15px; 
              margin: 10px 0; 
              border-left: 4px solid #5865F2; 
              border-radius: 5px; 
            }
            .features-box { 
              background: white; 
              padding: 20px; 
              margin: 15px 0; 
              border-radius: 5px; 
              border: 2px solid #5865F2;
            }
            .features-box h3 {
              color: #5865F2;
              margin-top: 0;
            }
            .features-content {
              white-space: pre-wrap;
              font-family: 'Courier New', monospace;
              background: #f5f5f5;
              padding: 15px;
              border-radius: 5px;
              margin-top: 10px;
            }
            .price { 
              background: #4CAF50; 
              color: white; 
              padding: 15px; 
              text-align: center; 
              font-size: 1.3em; 
              font-weight: bold; 
              border-radius: 5px; 
              margin: 20px 0; 
            }
            .logo-info {
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 15px 0;
              border-radius: 5px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🤖 Neue Bot-Bestellung!</h1>
            <p>Ein Kunde möchte einen Discord Bot bestellen</p>
          </div>
          
          <div class="content">
            <h2 style="color: #5865F2;">👤 Kundendaten</h2>
            
            <div class="info-box">
              <strong>Discord:</strong> ${orderData.discordUsername}
            </div>
            
            <div class="info-box">
              <strong>Discord ID:</strong> ${orderData.discordId}
            </div>
            
            <div class="info-box">
              <strong>Email:</strong> ${orderData.email}
            </div>
            
            <div class="info-box">
              <strong>Zeitpunkt:</strong> ${new Date(orderData.timestamp).toLocaleString('de-DE', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>

            <div class="features-box">
              <h3>📋 Was soll der Bot können?</h3>
              <div class="features-content">${orderData.botFeatures}</div>
            </div>

            ${orderData.additionalMessage !== 'Keine zusätzliche Nachricht' ? `
            <div class="features-box">
              <h3>💬 Sonstige Nachricht</h3>
              <div class="features-content">${orderData.additionalMessage}</div>
            </div>
            ` : ''}

            ${orderData.hasLogo ? `
            <div class="logo-info">
              <strong>🎨 Bot-Logo:</strong> Siehe Anhang dieser Email
            </div>
            ` : `
            <div class="info-box">
              <strong>🎨 Bot-Logo:</strong> Kein Logo hochgeladen
            </div>
            `}
            
            <div class="price">💰 Preis: 15€ oder weniger</div>
            <div style="text-align: center; color: #666; margin-top: 10px;">
              💳 Zahlung per PayPal oder Überweisung
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);
    
    console.log('✅ Order email sent for:', orderData.discordUsername);
    
    res.json({ 
      success: true, 
      message: 'Bestellung erfolgreich versendet!' 
    });

  } catch (error) {
    console.error('❌ Order submission error:', error);
    res.status(500).json({ 
      error: 'Fehler beim Versenden der Bestellung' 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Export for Vercel
module.exports = app;

// Local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}
