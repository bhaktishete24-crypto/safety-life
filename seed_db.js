const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error("MONGODB_URI is not defined in .env");
  process.exit(1);
}

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
  media: [{ type: String }],
  upvotes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const CrimeIncident = mongoose.model("CrimeIncident", crimeIncidentSchema, "crimeincidents");

mongoose
  .connect(mongoUri)
  .then(async () => {
    console.log("Connected to MongoDB Atlas for seeding...");

    // Read JSON data
    const dataPath = path.join(__dirname, "data", "crime_data_2025.json");
    if (!fs.existsSync(dataPath)) {
      console.error("crime_data_2025.json not found!");
      process.exit(1);
    }

    const rawData = fs.readFileSync(dataPath, "utf-8");
    const jsonData = JSON.parse(rawData);

    console.log(`Found ${jsonData.length} records in JSON file.`);

    // Clear existing data for 2025 to avoid duplicates
    await CrimeIncident.deleteMany({ year: 2025 });
    console.log("Cleared existing 2025 data from database.");

    // Map and insert
    const incidents = jsonData.map(item => ({
      lat: item.lat,
      lng: item.lng,
      intensity: item.intensity,
      category: item.category,
      severity: item.category === "high" ? "High" : item.category === "medium" ? "Medium" : "Low",
      year: 2025,
      description: `Reported incident in ${item.city}, ${item.state}`,
      location: `${item.city}, ${item.state}`,
      verified: true,
      status: "Verified",
      date: new Date().toLocaleDateString()
    }));

    await CrimeIncident.insertMany(incidents);
    console.log(`Successfully inserted ${incidents.length} records into 'crimeincidents' collection.`);

    console.log("Seeding complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seeding error:", err);
    process.exit(1);
  });
