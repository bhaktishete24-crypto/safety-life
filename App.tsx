// Last Updated: 2026-02-21
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMap } from "react-leaflet";
import L, { type LatLngExpression, type LeafletMouseEvent } from "leaflet";
import { AlertCircle, Shield, Navigation, Settings, Phone, Map as MapIcon, Info, User, Zap, ChevronRight, MapPin, ShieldCheck, Activity, Mail, Lock, ShieldAlert, BarChart3, Users, FileText, LogOut, Search, LayoutDashboard, Calendar } from "lucide-react";
import * as THREE from "three";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Three.js Shield Component ---
function SafetyShield() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const width = 40;
    const height = 40;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    const geometry = new THREE.OctahedronGeometry(1, 0);
    const material = new THREE.MeshPhongMaterial({
      color: 0x0ea5e9,
      wireframe: true,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.5
    });
    const shield = new THREE.Mesh(geometry, material);
    scene.add(shield);

    const light = new THREE.PointLight(0xffffff, 2, 100);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    camera.position.z = 2.5;

    const animate = () => {
      requestAnimationFrame(animate);
      shield.rotation.x += 0.01;
      shield.rotation.y += 0.01;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="w-10 h-10" />;
}

type RouteOption = {
  id: string;
  label: string;
  distanceKm: number;
  durationMin: number;
  geometry: LatLngExpression[];
  type: 'shortest' | 'medial' | 'longest';
};

type HeatPoint = {
  _id: string;
  lat: number;
  lng: number;
  intensity: number;
  category: "low" | "medium" | "high";
};

type UserProfile = {
  username: string;
  name: string;
  email: string;
  helplineNumber: string;
  phoneNumbers: string[];
};

const backendBaseUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

 const ROUTE_STYLES = {
  shortest: { color: "#10b981", label: "Shortest Way" },
  medial: { color: "#f59e0b", label: "Medial Way" },
  longest: { color: "#0ea5e9", label: "Longest Root" }
};

// --- Helper: Calculate Bearing ---
function calculateBearing(startLat: number, startLng: number, endLat: number, endLng: number) {
  const startLatRad = (startLat * Math.PI) / 180;
  const startLngRad = (startLng * Math.PI) / 180;
  const endLatRad = (endLat * Math.PI) / 180;
  const endLngRad = (endLng * Math.PI) / 180;

  const y = Math.sin(endLngRad - startLngRad) * Math.cos(endLatRad);
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(endLngRad - startLngRad);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function useGeolocation() {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported in this browser");
      return;
    }

    let lastLat: number | null = null;
    let lastLng: number | null = null;

    const watcher = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition(pos);
        if (pos.coords.heading !== null) {
          setHeading(pos.coords.heading);
        } else if (lastLat !== null && lastLng !== null) {
          // Calculate heading manually based on movement
          const dist = Math.sqrt(
            Math.pow(pos.coords.latitude - lastLat, 2) + 
            Math.pow(pos.coords.longitude - lastLng, 2)
          );
          
          // Only update heading if movement is significant enough (to avoid jitter)
          if (dist > 0.00001) { 
            const newHeading = calculateBearing(lastLat, lastLng, pos.coords.latitude, pos.coords.longitude);
            setHeading(newHeading);
          }
        }
        
        lastLat = pos.coords.latitude;
        lastLng = pos.coords.longitude;
        setError(null);
      },
      (err) => {
        setError(err.message);
      },
      { enableHighAccuracy: true }
    );

    // Fallback for device orientation if heading is not provided by GPS
    const handleOrientation = (e: any) => {
      if (e.webkitCompassHeading) {
        setHeading(e.webkitCompassHeading);
      } else if (e.alpha !== null) {
        setHeading(360 - e.alpha);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, true);

    return () => {
      navigator.geolocation.clearWatch(watcher);
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, []);

  return { position, heading, error };
}

type MapRouteProps = {
  route: RouteOption | null;
  current: LatLngExpression | null;
  destination: LatLngExpression | null;
};

// --- Map Event Listener ---
function MapEvents({ onMapClick }: { onMapClick: (e: LeafletMouseEvent) => void }) {
  const map = useMap();
  useEffect(() => {
    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
    };
  }, [map, onMapClick]);
  return null;
}

function MapRouteUpdater({ route = null, current, destination = null, isNavigating }: Partial<MapRouteProps> & { current: LatLngExpression | null; isNavigating: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    
    // If navigating or just want to follow current, follow the real-time location
    if ((isNavigating || !destination) && current) {
      // Use panTo for smoother following of the moving marker
      map.panTo(current, { animate: true, duration: 0.5 });
      return;
    }

    if (!current || !destination) return;

    const points: LatLngExpression[] = [];
    points.push(current);
    if (route) {
      points.push(...route.geometry);
    }
    points.push(destination);
    
    // Only fit bounds if we aren't already navigating
    // This prevents the map from jumping back to show the whole route
    // while the user is trying to follow the navigation marker.
    if (!isNavigating) {
      map.fitBounds(points as [number, number][], { padding: [50, 50] });
    }
  }, [map, route, current, destination, isNavigating]);

  return null;
}

function App() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { position, heading, error: geoError } = useGeolocation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [helplineInput, setHelplineInput] = useState("");
  const [numbersInput, setNumbersInput] = useState("");
  const [destination, setDestination] = useState<LatLngExpression | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [heatData, setHeatData] = useState<HeatPoint[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [sendingSos, setSendingSos] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);


  const [isInitializing, setIsInitializing] = useState(true);
  const [destinationInput, setDestinationInput] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [sosWhatsappLinks, setSosWhatsappLinks] = useState<string[]>([]);
  const [sosSmsLinks, setSosSmsLinks] = useState<string[]>([]);

  // --- Admin States ---
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  console.log("App Render - isAdminLoggedIn:", isAdminLoggedIn, "showDashboard:", showDashboard);

  // --- Complaint Form States ---
  const [crimeType, setCrimeType] = useState("");
  const [complaintDesc, setComplaintDesc] = useState("");
  const [complaintLocation, setComplaintLocation] = useState("");
  const [submittingComplaint, setSubmittingComplaint] = useState(false);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [userList, setUserList] = useState<any[]>([]);
  const [sosAlertsCount, setSosAlertsCount] = useState(0);

  const CRIME_TYPES = [
    "Theft", "Harassment", "Assault", "Vandalism", "Suspicious Activity", "Other"
  ];

  async function fetchComplaints() {
    try {
      console.log("Fetching crime reports...");
      const res = await axios.get(`${backendBaseUrl}/api/complaints`);
      console.log("Fetched reports:", res.data.length);
      setComplaints(res.data);
    } catch (err) {
      console.error("Failed to fetch complaints", err);
    }
  }

  async function fetchUsers() {
    try {
      const res = await axios.get(`${backendBaseUrl}/api/users`);
      setUserList(res.data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  }

  async function fetchSosCount() {
    try {
      const res = await axios.get(`${backendBaseUrl}/api/sos`);
      if (Array.isArray(res.data)) {
        setSosAlertsCount(res.data.length);
      }
    } catch (err) {
      console.error("Failed to fetch SOS alerts", err);
    }
  }

  useEffect(() => {
    if (showDashboard) {
      fetchComplaints();
      fetchUsers();
      fetchSosCount();
    }
  }, [showDashboard]);

  useEffect(() => {
    fetchComplaints();
    fetchUsers();
    fetchSosCount();
  }, []);

  async function handleComplaintSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) {
      setStatusMessage("Please login/save profile to submit a complaint");
      return;
    }
    if (!crimeType || !complaintDesc || !complaintLocation) {
      setStatusMessage("Please fill all fields");
      return;
    }

    setSubmittingComplaint(true);
    try {
      await axios.post(`${backendBaseUrl}/api/complaints`, {
        username: profile.username,
        crimeType,
        description: complaintDesc,
        location: complaintLocation,
        date: new Date().toLocaleDateString()
      });
      setStatusMessage("Complaint submitted successfully!");
      setCrimeType("");
      setComplaintDesc("");
      setComplaintLocation("");
      fetchComplaints();
    } catch (err) {
      setStatusMessage("Failed to submit complaint");
    } finally {
      setSubmittingComplaint(false);
    }
  }

  function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    const email = adminEmail.trim().toLowerCase();
    const pass = adminPassword.trim();
    
    console.log("Login attempt:", email, pass.length);
    
    if (email === "admin24@gmail.com" && (pass === "admin@2429" || pass === "admin2429")) {
      console.log("Credentials match!");
      setIsAdminLoggedIn(true);
      setShowDashboard(true);
      setStatusMessage("Admin Access Granted");
      // Use direct state update to ensure dashboard shows immediately
      setShowAdminLogin(false);
    } else {
      console.log("Credentials mismatch!");
      setStatusMessage("Invalid Admin Credentials");
    }
  }

  // Sync showDashboard with isAdminLoggedIn
  useEffect(() => {
    console.log("Admin States:", { isAdminLoggedIn, showDashboard, showAdminLogin });
    if (!isAdminLoggedIn && showDashboard) {
      setShowDashboard(false);
    }
  }, [isAdminLoggedIn, showDashboard, showAdminLogin]);

  useEffect(() => {
    // We only hide the splash screen after 2.5 seconds AND if we have a position OR an error
    // This ensures we wait for the permission prompt
    if (!isInitializing) return;

    const timer = setTimeout(() => {
      if (position || geoError) {
        setIsInitializing(false);
      }
    }, 2500); // 2.5 seconds splash minimum

    return () => clearTimeout(timer);
  }, [position, geoError, isInitializing]);

  const currentLatLng = useMemo<LatLngExpression | null>(() => {
    if (!position) return null;
    return [position.coords.latitude, position.coords.longitude];
  }, [position]);

  const selectedRoute = useMemo(() => 
    routes.find(r => r.id === selectedRouteId) || null, 
    [routes, selectedRouteId]
  );

  useEffect(() => {
    const stored = localStorage.getItem("safety_profile");
    if (!stored) {
      setShowProfileModal(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as UserProfile;
      setProfile(parsed);
    } catch {
      setShowProfileModal(true);
    }
  }, []);

  useEffect(() => {
    // Only auto-calculate initial routes when destination is first set
    // or if the destination specifically changes.
    // We REMOVED currentLatLng from dependencies to prevent route recalculation
    // every time the user moves a few meters.
    if (currentLatLng && destination && routes.length === 0) {
      calculateRoutes(currentLatLng, destination);
    }
  }, [destination]);

  useEffect(() => {
    // Fetch state-level crime data for 2025
    axios
      .get<HeatPoint[]>(`${backendBaseUrl}/api/crime-heatmap?year=2025`)
      .then((res) => {
        if (res.data && res.data.length > 0) {
          setHeatData(res.data);
        }
      })
      .catch(() => {
        // Fallback only if API fails completely
        if (currentLatLng) {
          const [lat, lng] = currentLatLng as [number, number];
          const expandedData: HeatPoint[] = [];
          for (let i = 0; i < 15; i++) {
            const angle = (i / 15) * Math.PI * 2;
            const distance = 0.01 + Math.random() * 0.04;
            const pLat = lat + Math.cos(angle) * distance;
            const pLng = lng + Math.sin(angle) * distance;
            const intensity = 0.2 + Math.random() * 0.7;
            const category = intensity > 0.7 ? 'high' : intensity > 0.4 ? 'medium' : 'low';
            expandedData.push({
              _id: `err-fallback-${i}`,
              lat: pLat,
              lng: pLng,
              intensity,
              category
            });
          }
          setHeatData(expandedData);
        }
      });
  }, [currentLatLng]);

  useEffect(() => {
    if (selectedRouteId && routes.length > 0) {
      setIsNavigating(true);
    } else {
      setIsNavigating(false);
    }
  }, [selectedRouteId, routes]);

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const numbers = numbersInput
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    // Validate 10-digit phone numbers
    const invalidNumbers = numbers.filter(n => !/^\d{10}$/.test(n.replace(/\D/g, "")));
    if (invalidNumbers.length > 0) {
      setStatusMessage("Each emergency contact must be a 10-digit number");
      return;
    }

    if (!usernameInput || !nameInput || !emailInput || !passwordInput || !helplineInput || numbers.length === 0) {
      setStatusMessage("All fields are required");
      return;
    }

    const user: UserProfile = {
      username: usernameInput,
      name: nameInput,
      email: emailInput,
      helplineNumber: helplineInput,
      phoneNumbers: numbers
    };

    setProfile(user);
    localStorage.setItem("safety_profile", JSON.stringify(user));
    setShowProfileModal(false);

    axios
      .post(`${backendBaseUrl}/api/users`, { ...user, password: passwordInput })
      .catch(() => undefined);
  }

  async function calculateRoutes(src: LatLngExpression | null, dst: LatLngExpression | null) {
    if (!src || !dst) return;
    setLoadingRoutes(true);
    setRoutes([]);
    setSelectedRouteId(null);
    setStatusMessage(null);

    try {
      const [srcLat, srcLng] = src as [number, number];
      const [dstLat, dstLng] = dst as [number, number];
      const url = `https://router.project-osrm.org/route/v1/driving/${srcLng},${srcLat};${dstLng},${dstLat}?alternatives=true&overview=full&geometries=geojson`;

      const res = await axios.get(url);
      const osrmRoutes = res.data.routes as any[];

      const options = osrmRoutes.map((r, index) => ({
        id: String(index),
        label: `Route ${index + 1}`,
        distanceKm: r.distance / 1000,
        durationMin: r.duration / 60,
        geometry: r.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]])
      }));

      const sorted = [...options].sort((a, b) => a.distanceKm - b.distanceKm);

      const finalRoutes: RouteOption[] = [];
      
      if (sorted.length >= 3) {
        // We have at least 3 routes, pick Shortest, Middle, and Longest
        finalRoutes.push({ ...sorted[0], label: "Shortest Way", type: "shortest" });
        finalRoutes.push({ ...sorted[Math.floor(sorted.length / 2)], label: "Medial Way", type: "medial" });
        finalRoutes.push({ ...sorted[sorted.length - 1], label: "Longest Root", type: "longest" });
      } else if (sorted.length === 2) {
        // We have 2 routes
        finalRoutes.push({ ...sorted[0], label: "Shortest Way", type: "shortest" });
        finalRoutes.push({ ...sorted[1], label: "Longest Root", type: "longest" });
        // Medial way is a clone of shortest but labeled differently
        finalRoutes.push({ ...sorted[0], label: "Medial Way", id: "alt-middle", type: "medial" });
      } else if (sorted.length === 1) {
        // Only 1 route
        finalRoutes.push({ ...sorted[0], label: "Shortest Way", type: "shortest" });
        finalRoutes.push({ ...sorted[0], label: "Medial Way", id: "alt-middle", type: "medial" });
        finalRoutes.push({ ...sorted[0], label: "Longest Root", id: "alt-long", type: "longest" });
      }

      setRoutes(finalRoutes);
      // Auto-select the shortest way by default
      const shortestRoute = finalRoutes.find(r => r.type === "shortest");
      if (shortestRoute) {
        setSelectedRouteId(shortestRoute.id);
      }
    } catch {
      setStatusMessage("Failed to load routes from the routing service");
    } finally {
      setLoadingRoutes(false);
    }
  }

  async function geocodeAddress(address: string): Promise<[number, number] | null> {
    if (!address) return null;
    try {
      const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
      if (res.data && res.data.length > 0) {
        return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
      }
      return null;
    } catch {
      return null;
    }
  }

  async function handleGo() {
    if (!destinationInput) {
      setStatusMessage("Please enter destination");
      return;
    }

    if (!currentLatLng) {
      setStatusMessage("Waiting for current location...");
      return;
    }

    setIsGeocoding(true);
    setStatusMessage("Searching destination...");

    try {
      const dst = await geocodeAddress(destinationInput);
      if (!dst) {
        setStatusMessage(`Could not find destination: ${destinationInput}`);
        setIsGeocoding(false);
        return;
      }
      
      setDestination(dst);
      await calculateRoutes(currentLatLng, dst);
      setStatusMessage("Route calculated successfully");
    } catch {
      setStatusMessage("An error occurred while searching");
    } finally {
      setIsGeocoding(false);
    }
  }

  function onMapClick(e: LeafletMouseEvent) {
    const coords: LatLngExpression = [e.latlng.lat, e.latlng.lng];
    const coordsString = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
    
    setDestination(coords);
    setDestinationInput(coordsString);
    if (currentLatLng) {
      calculateRoutes(currentLatLng, coords);
    }
  }

  function playSosTone() {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.0);
    osc.stop(ctx.currentTime + 1.0);
  }

  async function sendSos() {
    if (!profile || !currentLatLng) {
      setStatusMessage("Profile and current location are required for SOS");
      return;
    }

    setSendingSos(true);
    setStatusMessage(null);

    const [lat, lng] = currentLatLng as [number, number];
    const location = {
      lat,
      lng,
      address: `Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`
    };

    try {
      const res = await axios.post(`${backendBaseUrl}/api/sos`, {
        username: profile.username,
        name: profile.name,
        email: profile.email,
        helplineNumber: profile.helplineNumber,
        phoneNumbers: profile.phoneNumbers,
        location
      });
      playSosTone();
      fetchSosCount(); // Update SOS count after sending
      if (res.data.whatsappLinks) {
        setSosWhatsappLinks(res.data.whatsappLinks);
      }
      if (res.data.smsLinks) {
        setSosSmsLinks(res.data.smsLinks);
      }
      setStatusMessage("SOS sent! Click below to notify contacts via WhatsApp or SMS.");
    } catch {
      setStatusMessage("Failed to send SOS");
    } finally {
      setSendingSos(false);
    }
  }

  const mapCenter: LatLngExpression = currentLatLng || [19.076, 72.8777];

  if (showDashboard && isAdminLoggedIn) {
    return (
      <div className="fixed inset-0 min-h-screen w-full h-full bg-white text-slate-900 flex overflow-hidden z-[9999]">
        {/* Sidebar */}
        <aside className="w-72 border-r border-slate-100 bg-slate-50/50 backdrop-blur-3xl flex flex-col z-20">
          <div className="p-10 flex items-center gap-4">
            <div className="p-2 rounded-xl bg-white shadow-sm border border-slate-100">
              <SafetyShield />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase text-slate-900">
              Admin<span className="text-sky-600">Panel</span>
            </h1>
          </div>

          <nav className="flex-1 px-6 py-4 space-y-2">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "reports", label: "Crime Reports", icon: FileText },
              { id: "users", label: "User Database", icon: Users },
              { id: "analytics", label: "Safety Analytics", icon: BarChart3 },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-4 px-5 py-4 rounded-[1.5rem] text-xs font-black transition-all uppercase tracking-widest",
                  activeTab === item.id 
                    ? "bg-white text-sky-600 shadow-xl shadow-sky-500/5 border border-sky-100" 
                    : "text-slate-400 hover:bg-white/50 hover:text-slate-900"
                )}
              >
                <item.icon size={18} className={cn(activeTab === item.id ? "text-sky-600" : "text-slate-400")} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-6 border-t border-slate-100">
            <button 
              onClick={() => {
                setIsAdminLoggedIn(false);
                setShowDashboard(false);
              }}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-[1.5rem] text-xs font-black text-rose-500 hover:bg-rose-50 transition-all uppercase tracking-widest"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Header */}
          <header className="h-24 border-b border-slate-50 flex items-center justify-between px-10 bg-white/80 backdrop-blur-xl z-10">
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-[1.5rem] px-6 py-3 w-[400px] group focus-within:bg-white focus-within:border-sky-200 transition-all shadow-sm">
              <Search size={18} className="text-slate-400 group-focus-within:text-sky-600 transition-colors" />
              <input 
                type="text" 
                placeholder="Search intelligence records..." 
                className="bg-transparent border-none p-0 text-sm font-bold focus:ring-0 text-slate-900 placeholder:text-slate-300 w-full"
              />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Status</p>
                <p className="text-sm font-black text-emerald-500 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live System
                </p>
              </div>
              <div className="w-px h-10 bg-slate-100 mx-2" />
              <button 
                onClick={() => setShowDashboard(false)}
                className="px-8 py-3 rounded-[1.5rem] bg-slate-900 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:bg-sky-600 shadow-2xl shadow-slate-900/10 transition-all active:scale-95"
              >
                Exit to Map
              </button>
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            {activeTab === "overview" && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">System <span className="text-sky-600">Overview</span></h2>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Real-time Safety Network Status</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Server Time</p>
                    <p className="text-lg font-black text-slate-900 tracking-tighter">{new Date().toLocaleTimeString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {[
                    { label: "Total Reports", value: complaints.length, icon: FileText, color: "text-sky-600", bg: "bg-sky-50" },
                    { label: "Active Users", value: userList.length, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
                    { label: "SOS Alerts", value: sosAlertsCount, icon: Zap, color: "text-rose-600", bg: "bg-rose-50" },
                    { label: "Safety Score", value: "98%", icon: ShieldCheck, color: "text-amber-600", bg: "bg-amber-50" },
                  ].map((stat, i) => (
                    <div key={i} className="p-6 rounded-[2rem] bg-white border border-slate-100 shadow-sm group hover:shadow-md transition-all">
                      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 shadow-sm", stat.bg, stat.color)}>
                        <stat.icon size={24} />
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{stat.label}</p>
                      <h3 className="text-3xl font-black text-slate-900 tracking-tighter">{stat.value}</h3>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-sm">
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-6 flex items-center gap-3">
                      <Activity size={18} className="text-sky-600" />
                      Incident Frequency
                    </h3>
                    <div className="h-64 flex items-end gap-4 px-4 pb-4">
                      {[40, 70, 45, 90, 65, 80, 55].map((h, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-3">
                          <motion.div 
                            initial={{ height: 0 }}
                            animate={{ height: `${h}%` }}
                            className="w-full bg-sky-100 border-t-2 border-sky-600 rounded-t-lg relative group"
                          >
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-sky-600 text-white text-[8px] font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                              {h}%
                            </div>
                          </motion.div>
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Day {i+1}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-sm">
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-6 flex items-center gap-3">
                      <Shield size={18} className="text-emerald-600" />
                      Recent Activity
                    </h3>
                    <div className="space-y-4">
                      {complaints.slice(0, 4).map((c, i) => (
                        <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-md transition-all cursor-pointer">
                          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
                            <ShieldAlert size={18} />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-xs font-black text-slate-900 uppercase">{c.crimeType}</h4>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{c.location}</p>
                          </div>
                          <span className="text-[9px] font-black text-slate-400 uppercase">{c.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "reports" && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Crime <span className="text-sky-600">Reports</span></h2>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Manage and respond to incident filings</p>
                  </div>
                  <button className="px-6 py-3 rounded-2xl bg-white border border-slate-200 text-xs font-black text-slate-900 uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-3 shadow-sm">
                    <FileText size={16} className="text-sky-600" />
                    Export CSV
                  </button>
                </div>

                <div className="rounded-[2.5rem] bg-white border border-slate-200 overflow-hidden shadow-xl shadow-slate-200/50">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Reporter</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Type</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Location</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Date</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {complaints.map((c) => (
                          <tr key={c._id} className="hover:bg-slate-50 transition-colors group">
                            <td className="p-6">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600 text-xs font-black shadow-sm">
                                  {c.username?.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-bold text-sm text-slate-900">@{c.username}</span>
                              </div>
                            </td>
                            <td className="p-6">
                              <span className="px-3 py-1 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest border border-rose-100">
                                {c.crimeType}
                              </span>
                            </td>
                            <td className="p-6 text-slate-500 text-sm font-medium">{c.location}</td>
                            <td className="p-6 text-slate-500 text-sm font-medium">{c.date}</td>
                            <td className="p-6">
                              <span className="flex items-center gap-2 text-sky-600 text-[10px] font-black uppercase tracking-widest">
                                <div className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse" />
                                {c.status}
                              </span>
                            </td>
                            <td className="p-6">
                              <button className="p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-200 transition-all opacity-0 group-hover:opacity-100">
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {complaints.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                                  <FileText size={24} />
                                </div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No crime reports found in database</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "users" && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">User <span className="text-sky-600">Database</span></h2>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Manage registered system users</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest shadow-sm">
                      Total Users: {userList.length}
                    </div>
                  </div>
                </div>

                <div className="rounded-[2.5rem] bg-white border border-slate-200 overflow-hidden shadow-xl shadow-slate-200/50">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">User</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Email</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Emergency Contacts</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Helpline</th>
                          <th className="p-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {userList.map((user, idx) => (
                          <tr key={user._id || idx} className="hover:bg-slate-50 transition-colors group">
                            <td className="p-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center text-sky-600 shadow-sm border border-sky-100">
                                  <User size={20} />
                                </div>
                                <div>
                                  <div className="font-bold text-sm text-slate-900">{user.name}</div>
                                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">@{user.username}</div>
                                </div>
                              </div>
                            </td>
                            <td className="p-6 text-slate-500 text-sm font-medium">{user.email}</td>
                            <td className="p-6">
                              <div className="flex flex-wrap gap-2">
                                {user.phoneNumbers?.map((num: string, i: number) => (
                                  <span key={i} className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[10px] font-black border border-emerald-100 shadow-sm">
                                    {num}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-6 text-slate-500 text-sm font-medium">{user.helplineNumber}</td>
                            <td className="p-6">
                              <button className="p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-400 hover:text-sky-600 hover:border-sky-200 transition-all opacity-0 group-hover:opacity-100 shadow-sm">
                                <Settings size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {userList.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                                  <Users size={24} />
                                </div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No users found in database</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "analytics" && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Safety <span className="text-sky-600">Analytics</span></h2>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Advanced System Intelligence & Session Data</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Admin Session Card */}
                  <div className="lg:col-span-2 p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                      <Shield size={120} className="text-sky-600" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-8 flex items-center gap-3">
                      <User size={20} className="text-sky-600" />
                      Active Administrator Session
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                      <div className="space-y-6">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Session Identity</p>
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-sky-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-sky-600/20">
                              {profile?.name?.charAt(0) || "A"}
                            </div>
                            <div>
                              <p className="text-lg font-black text-slate-900">{profile?.name || "System Admin"}</p>
                              <p className="text-xs font-bold text-sky-600">@{profile?.username || "admin"}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Verified Email</p>
                          <p className="text-sm font-bold text-slate-600 flex items-center gap-2">
                            <Mail size={14} className="text-slate-400" />
                            {profile?.email || "admin24@gmail.com"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Security Status</p>
                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-black uppercase tracking-widest shadow-sm">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Encrypted Connection Active
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Access Level</p>
                          <p className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                            <Lock size={14} className="text-sky-600" />
                            Full System Authority
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Live GPS Card */}
                  <div className="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-sm flex flex-col justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-6 flex items-center gap-3">
                        <MapPin size={20} className="text-rose-600" />
                        Live Geolocation
                      </h3>
                      <div className="space-y-4">
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 shadow-inner">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Latitude</p>
                          <p className="text-xl font-black text-slate-900 tabular-nums tracking-tighter">
                            {Array.isArray(currentLatLng) ? currentLatLng[0].toFixed(6) : "19.076000"}
                          </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 shadow-inner">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Longitude</p>
                          <p className="text-xl font-black text-slate-900 tabular-nums tracking-tighter">
                            {Array.isArray(currentLatLng) ? currentLatLng[1].toFixed(6) : "72.877700"}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-8 pt-6 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                        <span className="text-slate-400">GPS Signal</span>
                        <span className="text-emerald-600 font-black">Excellent (98%)</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden shadow-inner">
                        <div className="w-[98%] h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  {[
                    { label: "Data Integrity", value: "99.9%", icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
                    { label: "API Latency", value: "24ms", icon: Zap, color: "text-sky-600", bg: "bg-sky-50" },
                    { label: "Threat Level", value: "Zero", icon: Activity, color: "text-slate-400", bg: "bg-slate-50" },
                    { label: "Uptime", value: "100%", icon: LayoutDashboard, color: "text-amber-600", bg: "bg-amber-50" },
                  ].map((metric, i) => (
                    <div key={i} className="p-6 rounded-3xl bg-white border border-slate-100 hover:shadow-md transition-all group">
                      <metric.icon size={20} className={cn("mb-4 transition-transform group-hover:scale-110", metric.color)} />
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{metric.label}</p>
                      <h4 className="text-2xl font-black text-slate-900 tracking-tighter group-hover:text-sky-600 transition-colors">{metric.value}</h4>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans selection:bg-sky-500/10 overflow-x-hidden relative">
      <AnimatePresence mode="wait">
        {isInitializing ? (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-white"
          >
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-sky-500/5 rounded-full blur-[120px] animate-pulse" />
            </div>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 1 }}
              className="relative flex flex-col items-center gap-8"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-sky-500/10 blur-3xl rounded-full scale-150" />
                <motion.div
                  animate={{ 
                    rotateY: [0, 180, 360],
                    scale: [1, 1.1, 1]
                  }}
                  transition={{ 
                    duration: 4, 
                    repeat: Infinity, 
                    ease: "linear" 
                  }}
                >
                  <SafetyShield />
                </motion.div>
              </div>

              <div className="flex flex-col items-center text-center">
                <motion.h1 
                  initial={{ letterSpacing: "0.5em", opacity: 0 }}
                  animate={{ letterSpacing: "0.1em", opacity: 1 }}
                  transition={{ delay: 0.5, duration: 1.2 }}
                  className="text-6xl md:text-8xl font-black bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent tracking-tighter"
                >
                  GUARDIAN<span className="text-sky-600">EYE</span>
                </motion.h1>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ delay: 1, duration: 1.5 }}
                  className="h-px bg-gradient-to-r from-transparent via-sky-500/20 to-transparent mt-4"
                />
                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.5, duration: 0.8 }}
                  className="text-[10px] md:text-xs uppercase tracking-[0.5em] text-slate-400 font-bold mt-6"
                >
                  Advanced Safety Intelligence System
                </motion.p>
                {geoError && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4 px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20"
                  >
                    <p className="text-[10px] text-rose-500 font-bold uppercase tracking-widest">
                      Please Enable Location Access to Continue
                    </p>
                  </motion.div>
                )}
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 }}
              className="absolute bottom-12 flex flex-col items-center gap-4"
            >
              <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="w-full h-full bg-sky-500"
                />
              </div>
              <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Initialising Core Protection</span>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
            className="flex flex-col"
          >
            {/* Nav Section */}
            <header className="sticky top-0 z-50 flex items-center justify-between px-8 py-5 border-b border-slate-100 bg-white/80 backdrop-blur-2xl">
              <div className="flex items-center gap-4">
                <SafetyShield />
                <h1 className="text-xl font-black bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 bg-clip-text text-transparent tracking-tighter">
                  GUARDIAN<span className="text-sky-600">EYE</span>
                </h1>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end px-4 py-2 rounded-xl bg-sky-50 border border-sky-100 backdrop-blur-md">
                  <span className="text-[10px] font-black text-sky-600 uppercase tracking-widest leading-none mb-1">Local Time</span>
                  <span className="text-sm font-black text-slate-900 tracking-tighter tabular-nums">
                    {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                {profile && (
                  <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-bold text-slate-600">{profile.username}</span>
                    <User size={14} className="text-sky-600" />
                  </div>
                )}
                <button
                  onClick={() => setShowProfileModal(true)}
                  className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all text-slate-400 hover:text-slate-900 shadow-sm"
                >
                  <Settings size={18} />
                </button>
                
                <button
                  onClick={() => {
                    setStatusMessage("");
                    if (isAdminLoggedIn) {
                      setShowDashboard(true);
                    } else {
                      setShowAdminLogin(true);
                    }
                  }}
                  className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all text-slate-400 hover:text-slate-900 shadow-sm"
                  title="Admin Dashboard"
                >
                  <Lock size={18} />
                </button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={sendSos}
                  disabled={sendingSos}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-rose-600/20 disabled:opacity-50"
                >
                  {sendingSos ? "Alerting..." : "SOS"}
                </motion.button>
              </div>
            </header>

            {/* Hero Section */}
            <section className="relative min-h-[60vh] flex flex-col items-center justify-center px-6 py-20 overflow-hidden text-center">
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sky-500/5 rounded-full blur-[100px]" />
              </div>
              
              <motion.div
                initial={{ y: 30, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                className="relative max-w-4xl mx-auto"
              >
                <h2 className="text-5xl md:text-7xl font-black text-slate-900 mb-6 tracking-tight leading-[1.1]">
                  Your Safety, <span className="text-sky-600">Redefined</span> by Intelligence
                </h2>
                <p className="text-lg md:text-xl text-slate-500 font-medium max-w-2xl mx-auto mb-12 leading-relaxed">
                  Navigate with confidence using real-time crime analysis and AI-powered safe routing. GuardianEye is your personal safety companion.
                </p>
                
                <div className="flex flex-wrap items-center justify-center gap-4">
                  <div className="px-6 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center gap-3">
                    <Shield className="text-sky-600" size={20} />
                    <span className="text-sm font-bold text-slate-600 uppercase tracking-widest">Secure Routing</span>
                  </div>
                  <div className="px-6 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center gap-3">
                    <Navigation className="text-sky-600" size={20} />
                    <span className="text-sm font-bold text-slate-600 uppercase tracking-widest">Real-time GPS</span>
                  </div>
                  <div className="px-6 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center gap-3">
                    <AlertCircle className="text-sky-600" size={20} />
                    <span className="text-sm font-bold text-slate-600 uppercase tracking-widest">Crime Heatmap</span>
                  </div>
                </div>

                {statusMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-8 p-6 rounded-[2rem] bg-white border border-slate-100 backdrop-blur-2xl max-w-md mx-auto shadow-2xl shadow-slate-200/50"
                  >
                    <p className="text-sm font-bold text-sky-600 mb-4">{statusMessage}</p>
                    
                    {sosWhatsappLinks.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <p className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400 mb-1">FREE WHATSAPP NOTIFICATION</p>
                        {sosWhatsappLinks.map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between px-5 py-4 rounded-2xl bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-all text-emerald-600 text-xs font-black uppercase tracking-widest group"
                          >
                            Notify Contact {idx + 1} (WA)
                            <Zap size={16} className="fill-emerald-500 group-hover:scale-110 transition-transform" />
                          </a>
                        ))}

                        {sosSmsLinks.length > 0 && (
                          <>
                            <p className="text-[10px] uppercase font-black tracking-[0.2em] text-slate-400 mt-4 mb-1">SMS NOTIFICATION</p>
                            {sosSmsLinks.map((link, idx) => (
                              <a
                                key={idx}
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between px-5 py-4 rounded-2xl bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-all text-blue-600 text-xs font-black uppercase tracking-widest group"
                              >
                                Notify Contact {idx + 1} (SMS)
                                <Zap size={16} className="fill-blue-500 group-hover:scale-110 transition-transform" />
                              </a>
                            ))}
                          </>
                        )}
                        
                        <button 
                          onClick={() => {
                            setSosWhatsappLinks([]);
                            setSosSmsLinks([]);
                            setStatusMessage(null);
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-2 uppercase font-black tracking-widest"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            </section>

            {/* Selection Section */}
            <section className="relative z-10 px-6 pb-20">
              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial={{ y: 40, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  className="bg-white/90 backdrop-blur-3xl border border-slate-100 rounded-[3rem] p-8 md:p-14 shadow-2xl shadow-slate-200/50"
                >
                  <div className="grid lg:grid-cols-2 gap-16">
                    <div className="space-y-10">
                      <div>
                        <h3 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Plan Your Journey</h3>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em]">Select your source and destination</p>
                      </div>

                      <div className="space-y-8">
                        {/* Source Input */}
                        <div className={cn(
                          "w-full flex items-center gap-6 p-7 rounded-[2rem] border transition-all text-left group bg-slate-50 border-slate-100/80 hover:bg-white hover:border-sky-200 hover:shadow-xl hover:shadow-sky-500/5"
                        )}>
                          <div className="p-4 rounded-2xl bg-sky-500/10 text-sky-600 group-hover:bg-sky-500 group-hover:text-white transition-all duration-500">
                            <MapPin size={28} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-1">Starting Point</span>
                            <div className="text-slate-900 font-bold text-lg">
                              {currentLatLng ? "Your Current Location" : "Detecting location..."}
                            </div>
                          </div>
                        </div>

                        {/* Destination Input */}
                        <div className={cn(
                          "w-full flex items-center gap-6 p-7 rounded-[2rem] border transition-all text-left group bg-slate-50 border-slate-100/80 hover:bg-white hover:border-sky-200 hover:shadow-xl hover:shadow-sky-500/5"
                        )}>
                          <div className="p-4 rounded-2xl bg-indigo-500/10 text-indigo-600 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-500">
                            <Navigation size={28} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-1">Final Destination</span>
                            <input
                              type="text"
                              value={destinationInput}
                              onChange={(e) => setDestinationInput(e.target.value)}
                              placeholder="Where are you heading?"
                              className="w-full bg-transparent border-none p-0 text-slate-900 font-bold text-lg placeholder:text-slate-300 focus:ring-0 focus:outline-none"
                            />
                          </div>
                        </div>

                        <motion.button
                          whileHover={{ scale: 1.02, y: -4 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleGo}
                          disabled={isGeocoding || loadingRoutes}
                          className="w-full py-7 rounded-[2rem] bg-slate-900 text-white font-black text-xl uppercase tracking-[0.2em] shadow-2xl shadow-slate-900/20 disabled:opacity-50 flex items-center justify-center gap-4 group overflow-hidden relative"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-sky-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                          <span className="relative z-10">
                            {isGeocoding || loadingRoutes ? (
                              <div className="w-7 h-7 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <div className="flex items-center gap-4">
                                START ANALYSIS
                                <ChevronRight className="group-hover:translate-x-2 transition-transform duration-500" size={24} />
                              </div>
                            )}
                          </span>
                        </motion.button>
                      </div>

                      <div className="p-6 rounded-[2rem] bg-slate-50 border border-slate-100 flex items-start gap-5">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600 shrink-0">
                          <Info size={20} />
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed font-medium">
                          The system will analyze crime data from <span className="text-sky-600 font-black">2024</span> along your path to ensure the highest safety rating.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-8">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xl font-black text-slate-900 tracking-tight">Recent Reports</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Live feed from your area</p>
                        </div>
                        <div className="px-4 py-2 rounded-xl bg-sky-50 border border-sky-100 text-sky-600 text-[10px] font-black uppercase tracking-widest">
                          Live Update
                        </div>
                      </div>

                      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
                        {complaints.length > 0 ? (
                          complaints.slice(0, 5).map((c, idx) => (
                            <motion.div
                              key={c._id || idx}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-6 rounded-3xl bg-white border border-slate-100 hover:border-sky-100 hover:shadow-xl hover:shadow-sky-500/5 transition-all group"
                            >
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                                    <ShieldAlert size={18} />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">{c.crimeType}</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{c.location}</p>
                                  </div>
                                </div>
                                <span className="text-[9px] font-black px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-tighter">
                                  {c.status}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed mb-4 line-clamp-2">{c.description}</p>
                              <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase">
                                  <Calendar size={12} />
                                  {c.date}
                                </div>
                                <button className="text-[10px] font-black text-sky-600 uppercase tracking-widest hover:text-sky-700 transition-colors">
                                  View Details
                                </button>
                              </div>
                            </motion.div>
                          ))
                        ) : (
                          <div className="py-20 flex flex-col items-center text-center opacity-40">
                            <Activity size={48} className="text-slate-300 mb-4" />
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No active reports in this sector</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Map Section */}
            <section className="px-6 pb-20">
              <div className="max-w-7xl mx-auto">
                <div className="relative h-[700px] rounded-[3rem] overflow-hidden border border-slate-200 shadow-2xl group">
                  {/* GPS Status Indicator */}
                  <div className="absolute top-6 left-6 z-[1000] flex items-center gap-2 bg-white/80 backdrop-blur-md border border-slate-100 px-4 py-2 rounded-2xl shadow-xl">
                    <div className={`w-2 h-2 rounded-full ${position ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                    <span className="text-[10px] font-bold text-slate-900 uppercase tracking-wider">
                      {position ? `GPS Active ${heading ? `| ${Math.round(heading)}°` : ''}` : 'Waiting for GPS...'}
                    </span>
                  </div>
                  <MapContainer
                    center={mapCenter}
                    zoom={14}
                    className="h-full w-full"
                    scrollWheelZoom
                  >
                    <MapEvents onMapClick={onMapClick} />
                    <TileLayer 
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      className="map-tiles"
                    />

                    {currentLatLng && (
                      <Marker position={currentLatLng} icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: isNavigating ? `
                          <div class="relative flex items-center justify-center">
                            <div class="absolute w-12 h-12 bg-sky-500/20 rounded-full animate-ping"></div>
                            <div class="relative w-10 h-10 bg-white rounded-2xl border-2 border-sky-500 shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center justify-center overflow-hidden transition-all duration-500 ease-out" style="transform: rotate(${(heading || 0) - 45}deg)">
                              <div class="absolute inset-0 bg-sky-500/5 animate-pulse"></div>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 11l19-9-9 19-2-8-8-2z"/>
                              </svg>
                            </div>
                          </div>
                        ` : `
                          <div class="relative flex items-center justify-center">
                            <div class="absolute w-8 h-8 bg-sky-500/30 rounded-full animate-ping"></div>
                            <div class="relative w-4 h-4 bg-sky-500 rounded-full border-2 border-white shadow-[0_0_10px_rgba(14,165,233,0.5)]"></div>
                          </div>
                        `,
                        iconSize: isNavigating ? [48, 48] : [32, 32],
                        iconAnchor: isNavigating ? [24, 24] : [16, 16]
                      })} />
                    )}

                    {destination && (
                      <Marker position={destination} icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `
                          <div class="relative flex items-center justify-center">
                            <div class="absolute w-8 h-8 bg-rose-500/30 rounded-full animate-pulse"></div>
                            <div class="relative w-4 h-4 bg-rose-500 rounded-full border-2 border-white shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>
                          </div>
                        `,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                      })} />
                    )}

                    {routes.map((route) => {
                      const isSelected = selectedRouteId === route.id;
                      const style = ROUTE_STYLES[route.type];
                      
                      return (
                        <React.Fragment key={route.id}>
                          {/* Outer Glow Line */}
                          <Polyline 
                            positions={route.geometry} 
                            pathOptions={{ 
                              color: style.color, 
                              weight: isSelected ? 12 : 8, 
                              opacity: isSelected ? 0.2 : 0.05,
                              lineJoin: 'round'
                            }} 
                            eventHandlers={{
                              click: () => setSelectedRouteId(route.id)
                            }}
                          />
                          {/* Main Route Line */}
                          <Polyline 
                            positions={route.geometry} 
                            pathOptions={{ 
                              color: style.color, 
                              weight: isSelected ? 5 : 3, 
                              opacity: isSelected ? 0.9 : 0.3,
                              lineJoin: 'round',
                              dashArray: isSelected ? '1, 10' : undefined,
                              dashOffset: '0'
                            }} 
                            eventHandlers={{
                              click: () => setSelectedRouteId(route.id)
                            }}
                          />
                          
                          {/* Distance & Duration Label at Midpoint (Only for selected) */}
                          {isSelected && route.geometry.length > 0 && (
                            <Marker 
                              position={route.geometry[Math.floor(route.geometry.length / 2)]} 
                              icon={L.divIcon({
                                className: 'route-label-icon',
                                html: `
                                  <div class="flex flex-col items-center justify-center bg-white/95 backdrop-blur-md border border-${route.type === 'shortest' ? 'emerald' : route.type === 'medial' ? 'amber' : 'sky'}-500/50 rounded-xl px-4 py-2 shadow-xl animate-in fade-in zoom-in duration-500 min-w-[100px]">
                                    <div class="flex items-center gap-2 mb-0.5">
                                      <span class="text-[9px] font-black uppercase tracking-[0.2em] text-${route.type === 'shortest' ? 'emerald' : route.type === 'medial' ? 'amber' : 'sky'}-600">${route.label}</span>
                                    </div>
                                    <div class="text-sm font-black text-slate-900 whitespace-nowrap">
                                      ${route.distanceKm.toFixed(1)} <span class="text-[10px] text-slate-400">KM</span>
                                    </div>
                                    <div class="w-full h-px bg-slate-100 my-1"></div>
                                    <div class="text-[10px] font-bold text-slate-500">
                                      ~${Math.round(route.durationMin)} MIN
                                    </div>
                                  </div>
                                `,
                                iconSize: [120, 60],
                                iconAnchor: [60, 30]
                              })}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}

                    <MapRouteUpdater 
                      route={selectedRoute} 
                      current={currentLatLng} 
                      destination={destination} 
                      isNavigating={isNavigating}
                    />
                  </MapContainer>

                  {/* Map Legend */}
                  <div className="absolute bottom-8 left-8 z-[1000]">
                    <div className="bg-white/90 backdrop-blur-xl border border-slate-100 rounded-3xl p-6 shadow-2xl">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Live Safety Indicators</p>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-rose-500/50 shadow-sm" />
                          <span className="text-xs font-bold text-slate-600">High Risk Area</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-amber-500/50 shadow-sm" />
                          <span className="text-xs font-bold text-slate-600">Moderate Risk</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-emerald-500/50 shadow-sm" />
                          <span className="text-xs font-bold text-slate-600">Secure Zone</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Route Preferences Section */}
            <section className="px-6 pb-20">
              <div className="max-w-7xl mx-auto">
                {routes.length > 0 ? (
                  <>
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      whileInView={{ y: 0, opacity: 1 }}
                      viewport={{ once: true }}
                      className="flex flex-col items-center text-center mb-12"
                    >
                      <h3 className="text-3xl font-black text-slate-900 mb-4">Select Your Path</h3>
                      <p className="text-slate-400 font-medium uppercase tracking-widest text-sm">Choose the route that fits your preference</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-6">
                      {routes.map((r) => {
                        const isSelected = selectedRouteId === r.id;
                        const styles = {
                          shortest: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", dot: "bg-emerald-500", glow: "shadow-emerald-500/10" },
                          medial: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600", dot: "bg-amber-500", glow: "shadow-amber-500/10" },
                          longest: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-600", dot: "bg-sky-500", glow: "shadow-sky-500/10" }
                        };
                        const style = styles[r.type];

                        return (
                          <motion.button
                            key={r.id}
                            whileHover={{ scale: 1.02, y: -5 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setSelectedRouteId(r.id)}
                            className={cn(
                              "relative p-8 rounded-[2.5rem] border transition-all text-left flex flex-col gap-6 group overflow-hidden",
                              isSelected 
                                ? `${style.bg} ${style.border} shadow-2xl ${style.glow}` 
                                : "bg-white border-slate-100 hover:border-slate-200 shadow-sm"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={cn("w-3 h-3 rounded-full", style.dot)} />
                                <span className={cn("text-xs font-black uppercase tracking-[0.2em]", isSelected ? style.text : "text-slate-400")}>
                                  {r.label}
                                </span>
                              </div>
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                                isSelected ? "bg-white text-slate-900 shadow-sm" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100"
                              )}>
                                <Navigation size={20} />
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div>
                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Total Distance</p>
                                <p className="text-3xl font-black text-slate-900">{r.distanceKm.toFixed(1)} <span className="text-sm text-slate-400">KM</span></p>
                              </div>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Duration</p>
                                  <p className="text-xl font-bold text-slate-600">~{Math.round(r.durationMin)} MIN</p>
                                </div>
                                {isSelected && (
                                  <motion.div
                                    layoutId="selected-check"
                                    className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-900"
                                  >
                                    <Zap size={14} fill="currentColor" />
                                  </motion.div>
                                )}
                              </div>
                            </div>

                            {/* Decorative background element */}
                            <div className={cn(
                              "absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-3xl opacity-10 transition-opacity",
                              isSelected ? "opacity-20" : "group-hover:opacity-15",
                              style.dot
                            )} />
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded-[3rem] p-20 flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 rounded-3xl bg-white border border-slate-100 flex items-center justify-center text-slate-300 mb-8 shadow-sm">
                      <Navigation size={40} className="animate-pulse" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 mb-4">Awaiting Selection</h3>
                    <p className="max-w-md text-slate-500 font-medium">
                      Select a destination on the map or enter an address above to view safety-optimized route options.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Crime Heatmap Section */}
            <section className="px-6 pb-20">
              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  className="flex flex-col items-center text-center mb-12"
                >
                  <h3 className="text-3xl font-black text-slate-900 mb-4">Crime Heatmap</h3>
                  <p className="text-slate-400 font-medium uppercase tracking-widest text-sm mb-6">Visualize crime-prone areas to avoid unsafe routes</p>
                  
                  <div className="flex flex-wrap items-center justify-center gap-6 mb-8">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-50 border border-rose-100">
                      <div className="w-2 h-2 rounded-full bg-rose-500 shadow-sm" />
                      <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">High Risk</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="w-2 h-2 rounded-full bg-amber-500 shadow-sm" />
                      <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Moderate Risk</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Secure Zone</span>
                    </div>
                  </div>
                </motion.div>

                <div className="relative h-[700px] rounded-[3rem] overflow-hidden border border-slate-200 shadow-2xl">
                  <MapContainer
                    center={[20.5937, 78.9629]} // Center of India
                    zoom={5}
                    className="h-full w-full"
                    scrollWheelZoom
                  >
                    <TileLayer 
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    
                    {heatData.map((p) => {
                      const color = p.category === "high" ? "#ef4444" : p.category === "medium" ? "#eab308" : "#22c55e";
                      const radius = 35 + p.intensity * 45;
                      const crimePercentage = Math.round(p.intensity * 100);
                      
                      return (
                        <React.Fragment key={`heatmap-group-${p._id}`}>
                          <CircleMarker
                            center={[p.lat, p.lng]}
                            radius={radius}
                            pathOptions={{ 
                              color: 'transparent', 
                              fillColor: color, 
                              fillOpacity: 0.3 
                            }}
                          />
                          <Marker 
                            position={[p.lat, p.lng]} 
                            icon={L.divIcon({
                              className: 'crime-percentage-label',
                              html: `
                                <div class="flex flex-col items-center justify-center">
                                  <div class="px-2.5 py-1 rounded-xl bg-white/95 backdrop-blur-md border border-slate-100 shadow-xl flex flex-col items-center gap-0.5 min-w-[80px]">
                                    <span class="text-[7px] font-black uppercase tracking-tighter ${
                                      p.category === 'high' ? 'text-rose-600' : 
                                      p.category === 'medium' ? 'text-amber-600' : 'text-emerald-600'
                                    }">
                                      ${p.category === 'high' ? 'High Risk' : p.category === 'medium' ? 'Moderate Risk' : 'Secure Zone'}
                                    </span>
                                    <span class="text-[10px] font-black text-slate-900">${crimePercentage}%</span>
                                  </div>
                                </div>
                              `,
                              iconSize: [100, 40],
                              iconAnchor: [50, 20]
                            })}
                          />
                        </React.Fragment>
                      );
                    })}

                    {currentLatLng && (
                      <Marker position={currentLatLng} icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `
                          <div class="relative flex items-center justify-center">
                            <div class="absolute w-8 h-8 bg-sky-500/20 rounded-full animate-ping"></div>
                            <div class="relative w-4 h-4 bg-sky-500 rounded-full border-2 border-white shadow-lg"></div>
                          </div>
                        `,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                      })} />
                    )}
                  </MapContainer>
                  
                  {/* Floating Heatmap Purpose Overlay */}
                  <div className="absolute top-8 left-8 z-[1000] max-w-xs">
                    <div className="bg-white/90 backdrop-blur-xl border border-slate-100 rounded-3xl p-6 shadow-2xl">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
                          <MapIcon size={18} />
                        </div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Purpose</h4>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed font-medium">
                        Analyze historical crime patterns to identify hotspots. This helps you plan safer routes by avoiding high-density zones.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>



            {/* Crime Complaint Section */}
            <section className="px-6 pb-20">
              <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  {/* Left: Complaint Form */}
                  <motion.div
                    initial={{ x: -20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    className="p-10 rounded-[3rem] bg-white border border-slate-200 shadow-xl relative overflow-hidden"
                  >
                    <div className="relative z-10">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 border border-rose-100 shadow-sm">
                          <ShieldAlert size={28} />
                        </div>
                        <div>
                          <h3 className="text-2xl font-black text-slate-900">Report Incident</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Help us keep the community safe</p>
                        </div>
                      </div>

                      <form onSubmit={handleComplaintSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Type of Crime</label>
                            <select
                              value={crimeType}
                              onChange={(e) => setCrimeType(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-4 text-sm text-slate-900 focus:outline-none focus:border-rose-500/50 transition-all appearance-none"
                            >
                              <option value="" disabled className="bg-white">Select Type</option>
                              {CRIME_TYPES.map(t => (
                                <option key={t} value={t} className="bg-white">{t}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Location</label>
                            <div className="relative group">
                              <MapIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-rose-500 transition-colors" size={18} />
                              <input
                                type="text"
                                value={complaintLocation}
                                onChange={(e) => setComplaintLocation(e.target.value)}
                                placeholder="e.g. Bandra West"
                                className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-rose-500/50 transition-all"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Description</label>
                          <textarea
                            value={complaintDesc}
                            onChange={(e) => setComplaintDesc(e.target.value)}
                            placeholder="Provide details about the incident..."
                            rows={4}
                            className="w-full bg-slate-50 border border-slate-200 rounded-3xl py-4 px-6 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-rose-500/50 transition-all resize-none"
                          />
                        </div>

                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={submittingComplaint}
                          className="w-full py-5 rounded-3xl bg-rose-500 text-white font-black uppercase tracking-[0.2em] shadow-lg shadow-rose-500/20 hover:shadow-xl hover:shadow-rose-500/30 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                          {submittingComplaint ? (
                            <Activity className="animate-spin" size={20} />
                          ) : (
                            <>
                              <ShieldAlert size={20} />
                              Submit Complaint
                            </>
                          )}
                        </motion.button>
                      </form>
                    </div>
                    {/* Background decoration */}
                    <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-rose-500/5 blur-[120px] rounded-full" />
                  </motion.div>

                  {/* Right: Recent Complaints */}
                  <motion.div
                    initial={{ x: 20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    className="flex flex-col"
                  >
                    <div className="flex items-center justify-between mb-8 px-2">
                      <div>
                        <h3 className="text-xl font-black text-slate-900">Recent Reports</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Live Safety Feed</p>
                      </div>
                      <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-100 shadow-sm">
                        <span className="text-xs font-bold text-slate-400">{complaints.length} Total</span>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {complaints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400 border border-dashed border-slate-100 rounded-[2.5rem]">
                          <Activity size={40} className="mb-4 opacity-20" />
                          <p className="text-xs font-bold uppercase tracking-widest">No reports yet</p>
                        </div>
                      ) : (
                        complaints.map((c) => (
                          <motion.div
                            key={c._id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-6 rounded-3xl bg-white border border-slate-100 hover:border-sky-100 hover:shadow-xl hover:shadow-sky-500/5 transition-all group"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                                  <ShieldAlert size={18} />
                                </div>
                                <div>
                                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">{c.crimeType}</h4>
                                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{c.location}</p>
                                </div>
                              </div>
                              <span className="text-[9px] font-black px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-tighter">
                                {c.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-4 group-hover:text-slate-700 transition-colors">
                              {c.description}
                            </p>
                            <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                              <div className="flex items-center gap-2">
                                <User size={12} className="text-slate-400" />
                                <span className="text-[10px] font-bold text-slate-500">@{c.username}</span>
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">{c.date}</span>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </div>
              </div>
            </section>

            {/* Footer / Status */}
            <footer className="px-8 py-12 border-t border-slate-100 flex flex-col items-center text-center">
              <div className="flex items-center gap-4 mb-8">
                <SafetyShield />
                <span className="text-2xl font-black text-slate-900 tracking-tighter">GUARDIAN<span className="text-sky-500">EYE</span></span>
              </div>
              <p className="text-sm text-slate-500 font-medium max-w-md">
                Dedicated to providing real-time safety insights and secure navigation for everyone. Always stay alert and connected.
              </p>
              
              <AnimatePresence>
                {statusMessage && (
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl bg-sky-500 text-white text-sm font-bold shadow-2xl z-[6000]"
                  >
                    {statusMessage}
                  </motion.div>
                )}
              </AnimatePresence>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Login Modal */}
      <AnimatePresence>
        {showAdminLogin && (
          <div className="fixed inset-0 z-[7000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminLogin(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xl"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-sky-500 to-transparent" />
              
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-600 shadow-sm border border-sky-100">
                    <Lock size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Admin <span className="text-sky-600">Login</span></h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Restricted Access Only</p>
                  </div>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-6">
                  {statusMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "p-4 rounded-2xl border text-[10px] font-black uppercase tracking-widest text-center",
                        statusMessage.includes("Granted") 
                          ? "bg-emerald-50 border-emerald-100 text-emerald-600" 
                          : "bg-rose-50 border-rose-100 text-rose-600"
                      )}
                    >
                      {statusMessage}
                    </motion.div>
                  )}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Admin Email</label>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="text"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="admin@guardianeye.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Secure Password</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-sky-600 hover:bg-sky-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-sky-600/20 transition-all active:scale-[0.98] mt-4 uppercase tracking-widest text-xs"
                  >
                    Enter Control Center
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminLogin(false);
                      setShowDashboard(false);
                    }}
                    className="w-full text-slate-400 hover:text-slate-900 text-[10px] font-black uppercase tracking-widest py-2 transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => profile && setShowProfileModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xl"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-[2.5rem] bg-white border border-slate-200 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-br from-sky-500/10 to-indigo-500/10" />
              
              <div className="relative p-10 pt-12">
                <div className="flex flex-col items-center text-center mb-10">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-xl mb-6 transform -rotate-6">
                    <Shield size={40} />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Secure Identity</h2>
                  <p className="text-sm text-slate-500 font-medium">Configure your emergency credentials</p>
                </div>

                <form onSubmit={saveProfile} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Full Name</label>
                    <div className="relative group">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="e.g. Akshay Kumar"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Username</label>
                      <div className="relative group">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                        <input
                          type="text"
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          placeholder="akshay_07"
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Email</label>
                      <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="akshay@mail.com"
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Password</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Official Helpline Number</label>
                    <div className="relative group">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="text"
                        value={helplineInput}
                        onChange={(e) => setHelplineInput(e.target.value)}
                        placeholder="e.g. 100 or 112"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Family Emergency Contacts</label>
                    <div className="relative group">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-600 transition-colors" size={18} />
                      <input
                        type="text"
                        value={numbersInput}
                        onChange={(e) => setNumbersInput(e.target.value)}
                        placeholder="10-digit Numbers (comma separated)"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500/50 transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 ml-1">Example: 9876543210, 8765432109 (WhatsApp valid)</p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-sky-600 hover:bg-sky-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-sky-600/20 transition-all active:scale-[0.98] mt-4"
                  >
                    AUTHORIZE SYSTEM
                  </button>
                </form>

                {profile && (
                  <button
                    onClick={() => setShowProfileModal(false)}
                    className="w-full text-slate-400 hover:text-slate-900 text-xs font-bold py-4 transition-colors"
                  >
                    DISMISS
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;

