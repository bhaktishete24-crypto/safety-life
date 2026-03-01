// Last Updated: 2026-02-21
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const bcrypt = require("bcryptjs");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/guardian_eye_db";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  helplineNumber: { type: String, required: true },
  phoneNumbers: [{ type: String, required: true }], // Legacy support
  trustedContacts: [{
    name: String,
    phone: String,
    relation: String
  }],
  medicalInfo: {
    bloodGroup: String,
    allergies: String,
    conditions: String
  },
  homeAddress: String,
  createdAt: { type: Date, default: Date.now }
});

const sosEventSchema = new mongoose.Schema({
  username: { type: String, required: true },
  name: String,
  email: String,
  helplineNumber: String,
  phoneNumbers: [{ type: String, required: true }],
  location: {
    lat: Number,
    lng: Number,
    address: String
  },
  status: { type: String, enum: ["Active", "Resolved", "False Alarm"], default: "Active" },
  alertType: { type: String, enum: ["General", "Medical", "Police", "Fire"], default: "General" },
  evidence: [{ type: String }], // URLs to audio/video
  createdAt: { type: Date, default: Date.now }
});

const crimeIncidentSchema = new mongoose.Schema({
  lat: Number,
  lng: Number,
  intensity: { type: Number, min: 0, max: 1 },
  category: { type: String, enum: ["low", "medium", "high"] },
  severity: { type: String, enum: ["Critical", "High", "Medium", "Low"], default: "Medium" },
  year: Number,
  username: String,
  crimeType: String,
  description: String,
  location: String,
  date: String,
  status: { type: String, default: "Pending" },
  verified: { type: Boolean, default: false },
  media: [{ type: String }], // URLs to images/videos
  upvotes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const SosEvent = mongoose.model("SosEvent", sosEventSchema);
const CrimeIncident = mongoose.model("CrimeIncident", crimeIncidentSchema, "crimeincidents");
// Remove separate Complaint model to use crimeincidents collection
// const Complaint = mongoose.model("Complaint", complaintSchema);

// In-memory fallback
const memoryStorage = {
  users: [],
  sosEvents: [],
  complaints: [], // Cleared for fresh start
  crimeIncidents: [
    { _id: "1", lat: 19.076, lng: 72.8777, intensity: 0.9, category: "high", severity: "High", year: 2025, verified: true },
    { _id: "2", lat: 19.2183, lng: 72.9781, intensity: 0.6, category: "medium", severity: "Medium", year: 2025, verified: true },
    { _id: "3", lat: 19.051, lng: 72.900, intensity: 0.3, category: "low", severity: "Low", year: 2025, verified: true }
  ]
};

let useMemory = false;

app.use(cors());
app.use(express.json());

mongoose
  .connect(mongoUri, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log("Connected to MongoDB Atlas successfully!");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    console.log("Falling back to memory storage.");
    useMemory = true;
  });

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", storage: useMemory ? "memory" : "mongodb" });
});

app.post("/api/users", async (req, res) => {
  try {
    const { username, name, email, password, helplineNumber, phoneNumbers } = req.body;
    
    if (!username || !name || !email || !password || !helplineNumber || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (useMemory) {
      let user = memoryStorage.users.find(u => u.username === username || u.email === email);
      if (user) {
        user.name = name;
        user.email = email;
        user.password = hashedPassword;
        user.helplineNumber = helplineNumber;
        user.phoneNumbers = phoneNumbers;
      } else {
        user = { username, name, email, password: hashedPassword, helplineNumber, phoneNumbers, createdAt: new Date() };
        memoryStorage.users.push(user);
      }
      const { password: _, ...userWithoutPassword } = user;
      return res.json(userWithoutPassword);
    }

    let user = await User.findOne({ $or: [{ username }, { email }] });
    if (user) {
      user.name = name;
      user.email = email;
      user.password = hashedPassword;
      user.helplineNumber = helplineNumber;
      user.phoneNumbers = phoneNumbers;
      await user.save();
    } else {
      user = await User.create({ 
        username, 
        name, 
        email, 
        password: hashedPassword, 
        helplineNumber, 
        phoneNumbers 
      });
    }

    const userObj = user.toObject();
    delete userObj.password;
    res.status(201).json(userObj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save user profile" });
  }
});

app.post("/api/sos", async (req, res) => {
  try {
    const { username, name, email, helplineNumber, phoneNumbers, location } = req.body;
    if (!username || !Array.isArray(phoneNumbers) || !location) {
      return res.status(400).json({ message: "username, phoneNumbers and location are required" });
    }

    const sosMessage = `🚨 SOS ALERT 🚨\n\n` +
      `User: ${name || username} (@${username})\n` +
      `Email: ${email || "N/A"}\n` +
      `Emergency Helpline: ${helplineNumber || "N/A"}\n` +
      `Location: https://www.google.com/maps?q=${location.lat},${location.lng}\n` +
      `Address: ${location.address}\n` +
      `Time: ${new Date().toLocaleString()}\n\n` +
      `Please take immediate action!`;

    // Generate a WhatsApp Click-to-Chat URL for each number (Free fallback)
    const whatsappLinks = phoneNumbers.map(num => {
      const cleanNum = num.replace(/\D/g, "");
      // Ensure it has a country code, default to 91 (India) if 10 digits
      const formattedNum = cleanNum.length === 10 ? `91${cleanNum}` : cleanNum;
      return `https://wa.me/${formattedNum}?text=${encodeURIComponent(sosMessage)}`;
    });

    // Generate SMS Links for each number
    const smsLinks = phoneNumbers.map(num => {
      const cleanNum = num.replace(/\D/g, "");
      const formattedNum = cleanNum.length === 10 ? `+91${cleanNum}` : `+${cleanNum}`;
      // Standard SMS URI scheme
      return `sms:${formattedNum}?body=${encodeURIComponent(sosMessage)}`;
    });

    // Simulate sending SMS/WhatsApp to each number
    phoneNumbers.forEach((num, index) => {
      console.log(`-----------------------------------------`);
      console.log(`[FREE SERVICE] PREPARING WHATSAPP FOR: ${num}`);
      console.log(`DIRECT LINK: ${whatsappLinks[index]}`);
      console.log(`MESSAGE:\n${sosMessage}`);
      console.log(`-----------------------------------------`);
    });

    // --- AUTOMATED SMS SENDING (Textbelt / Fast2SMS) ---
    // Note: To use a real reliable SMS service, you need an API key from providers like Twilio or Fast2SMS.
    // Here we implement a basic handler that attempts to use Textbelt (1 free SMS/day) or just logs the action.
    
    const sendRealSMS = async () => {
      console.log("Attempting to send automated SMS via backend...");
      
      // Example using Textbelt (Free tier: 1 SMS per day per IP)
      // For production, replace this with Twilio/Fast2SMS integration
      for (const num of phoneNumbers) {
        try {
          const cleanNum = num.replace(/\D/g, "");
          // Textbelt requires country code (e.g., +91 or +1)
          // Default to India (+91) if 10 digits
          const formattedNum = cleanNum.length === 10 ? `+91${cleanNum}` : `+${cleanNum}`;
          
          console.log(`Sending SMS to ${formattedNum}...`);
          
          // UNCOMMENT THE CODE BELOW TO ENABLE REAL SENDING (Rate limited)
          /*
          const response = await axios.post('https://textbelt.com/text', {
            phone: formattedNum,
            message: sosMessage,
            key: 'textbelt', // 'textbelt' key is for free tier (1 per day)
          });
          console.log(`Textbelt Response for ${formattedNum}:`, response.data);
          */
         
         // Mock Log for now to avoid using up the 1 free credit during testing without permission
         console.log(`[MOCK SEND] SMS would be sent to ${formattedNum} with message: "${sosMessage.substring(0, 50)}..."`);
         
         // --- FAST2SMS (Indian Service) Implementation ---
         /*
         if (process.env.FAST2SMS_API_KEY) {
           // Fast2SMS API integration
           // ...
         }
         */
        } catch (error) {
          console.error(`Failed to send SMS to ${num}:`, error.message);
        }
      }
    };
    
    // Fire and forget - don't wait for SMS API to finish before responding to frontend
    sendRealSMS();

    const sosData = { username, name, email, helplineNumber, phoneNumbers, location };

    if (useMemory) {
      const sos = { ...sosData, createdAt: new Date(), id: Date.now() };
      memoryStorage.sosEvents.push(sos);
      return res.status(201).json({ 
        message: "SOS event stored (memory) and free notification links generated", 
        sosId: sos.id,
        notificationLog: `Generated ${phoneNumbers.length} WhatsApp links`,
        whatsappLinks: whatsappLinks,
        smsLinks: smsLinks
      });
    }

    const sos = await SosEvent.create(sosData);
    res.status(201).json({ 
      message: "SOS event stored and free notification links generated", 
      sosId: sos._id,
      notificationLog: `Generated ${phoneNumbers.length} WhatsApp links`,
      whatsappLinks: whatsappLinks,
      smsLinks: smsLinks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to store SOS event" });
  }
});

app.get("/api/sos", async (req, res) => {
  try {
    if (useMemory) {
      return res.json(memoryStorage.sosEvents);
    }
    const sosEvents = await SosEvent.find().sort({ createdAt: -1 });
    res.json(sosEvents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch SOS events" });
  }
});

app.get("/api/crime-heatmap", async (req, res) => {
  try {
    const year = parseInt(req.query.year || "2024", 10);

    if (year === 2025) {
      // Prioritize fetching from MongoDB
      if (!useMemory) {
        try {
          // Use maxTimeMS instead of timeout which is not a function in this version
          let data = await CrimeIncident.find({ year: 2025 }).maxTimeMS(5000);
          if (data.length > 0) {
            return res.json(data);
          }
        } catch (dbErr) {
          console.error("DB fetch failed, falling back to file:", dbErr.message);
        }
      }

      // Fallback to file system if DB is empty or connection failed
      const dataPath = path.join(__dirname, "data", "crime_data_2025.json");
      if (fs.existsSync(dataPath)) {
        const rawData = fs.readFileSync(dataPath, "utf-8");
        const jsonData = JSON.parse(rawData);
        // Map to include year for filtering if needed
        return res.json(jsonData.map(item => ({ ...item, year: 2025, _id: item.id })));
      }
    }

    if (useMemory) {
      return res.json(memoryStorage.crimeIncidents.filter(i => i.year === year));
    }

    let data = await CrimeIncident.find({ year });

    if (data.length === 0) {
      const sample = [
        { lat: 19.076, lng: 72.8777, intensity: 0.9, category: "high", year },
        { lat: 19.2183, lng: 72.9781, intensity: 0.6, category: "medium", year },
        { lat: 19.051, lng: 72.900, intensity: 0.3, category: "low", year }
      ];
      data = await CrimeIncident.insertMany(sample);
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load heatmap data", error: err.toString() });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    if (useMemory) {
      return res.json(memoryStorage.users);
    }
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// --- Complaint Endpoints (now storing in crimeincidents) ---
app.post("/api/complaints", async (req, res) => {
  console.log("POST /api/complaints request received:", req.body);
  try {
    const { username, crimeType, description, location, date } = req.body;
    
    if (!username || !crimeType || !description || !location || !date) {
      console.log("Missing fields in complaint submission");
      return res.status(400).json({ message: "All fields are required" });
    }

    if (useMemory) {
      console.log("Saving complaint to memory storage");
      const newComplaint = {
        _id: Math.random().toString(36).substr(2, 9),
        username,
        crimeType,
        description,
        location,
        date,
        status: "Pending",
        createdAt: new Date(),
        year: new Date().getFullYear() // adding year for consistency with heatmap data
      };
      memoryStorage.complaints.push(newComplaint);
      return res.status(201).json(newComplaint);
    }

    console.log("Saving complaint to MongoDB Atlas in 'crimeincidents' collection");
    const complaint = await CrimeIncident.create({
      username,
      crimeType,
      description,
      location,
      date,
      year: new Date().getFullYear() // adding year for consistency
    });
    console.log("Complaint saved successfully:", complaint._id);
    res.status(201).json(complaint);
  } catch (err) {
    console.error("Submission Error:", err);
    res.status(500).json({ message: "Failed to submit complaint" });
  }
});

app.get("/api/complaints", async (req, res) => {
  console.log("GET /api/complaints request received");
  try {
    if (useMemory) {
      console.log("Fetching complaints from memory storage, count:", memoryStorage.complaints.length);
      return res.json(memoryStorage.complaints);
    }
    
    // Fetch ALL records from crimeincidents collection as requested by user
    console.log("Fetching ALL records from MongoDB Atlas 'crimeincidents' collection");
    const complaints = await CrimeIncident.find().sort({ createdAt: -1 });
    console.log(`Found ${complaints.length} total records in crimeincidents`);
    
    // Map data to ensure consistent format for frontend
    const formattedData = complaints.map(c => {
      const obj = c.toObject();
      return {
        ...obj,
        username: obj.username || "SYSTEM_HEATMAP",
        crimeType: obj.crimeType || (obj.category ? `Heatmap: ${obj.category}` : "Unknown"),
        location: obj.location || (obj.lat ? `${obj.lat.toFixed(4)}, ${obj.lng.toFixed(4)}` : "Unknown"),
        date: obj.date || (obj.createdAt ? new Date(obj.createdAt).toLocaleDateString() : "N/A"),
        status: obj.status || "Logged"
      };
    });
    
    res.json(formattedData);
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch complaints" });
  }
});

// For Vercel, we need to export the app.
// Vercel manages the port binding itself for serverless functions.
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = app;

