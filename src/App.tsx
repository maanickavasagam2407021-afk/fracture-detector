import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Activity, 
  Upload, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  Info,
  RefreshCw,
  TrendingUp,
  ShieldAlert,
  Usb,
  Play,
  Square,
  Zap
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeVibrationSignal, AnalysisResult } from './services/geminiService';
import { cn } from './lib/utils';

interface SignalData {
  time: number;
  amplitude: number;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [data, setData] = useState<SignalData[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Arduino Serial State
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastValue, setLastValue] = useState<string>("None");
  const [baudRate, setBaudRate] = useState<number>(9600);
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const dataPointsRef = useRef<SignalData[]>([]);
  const startTimeRef = useRef<number>(0);

  const connectArduino = async () => {
    try {
      setError(null);
      if (!('serial' in navigator)) {
        setError("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
        return;
      }

      // Try to see if we already have authorized ports to avoid the popup if possible
      const existingPorts = await (navigator as any).serial.getPorts();
      let port;
      
      if (existingPorts.length > 0) {
        // If we have existing ports, we'll still call requestPort to let the user choose,
        // but this helps us know if we're in a context where it's likely to work.
        console.log("Existing ports available:", existingPorts.length);
      }

      try {
        port = await (navigator as any).serial.requestPort();
      } catch (requestErr: any) {
        // Handle the specific "No port selected" error which is thrown when user cancels
        if (requestErr.name === 'NotFoundError' || requestErr.message.includes('No port selected')) {
          console.log("User cancelled port selection");
          return; // Exit silently as this is a user action, not a system error
        }
        throw requestErr; // Re-throw other errors
      }

      await port.open({ baudRate });
      portRef.current = port;
      setIsConnected(true);
      setError(null);
    } catch (err: any) {
      console.error("Serial connection error:", err);
      if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
        setError("Browser Security Block: Access to serial ports is restricted in this preview. Please click 'Open in New Tab' at the top right to use the full feature.");
      } else if (err.name === 'NetworkError') {
        setError("The selected port is already in use. Please close any other apps (like Arduino IDE) using this port.");
      } else {
        setError(`Connection failed: ${err.message || "Unknown error"}. Make sure your Arduino is connected.`);
      }
    }
  };

  const startStreaming = async () => {
    if (!portRef.current) return;
    
    setIsStreaming(true);
    setData([]);
    dataPointsRef.current = [];
    startTimeRef.current = Date.now();
    setResult(null);

    try {
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = portRef.current.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let partialLine = "";
      let pointsCount = 0;
      
      // Use an interval to update the UI at 30fps instead of on every data point
      const uiUpdateInterval = setInterval(() => {
        setData([...dataPointsRef.current]);
      }, 33);

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          clearInterval(uiUpdateInterval);
          break;
        }
        
        const chunk = partialLine + value;
        const lines = chunk.split('\n');
        partialLine = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (pointsCount < 5) {
            console.log("Received data line:", trimmed);
          }
          setLastValue(trimmed);
          pointsCount++;

          const amplitude = parseFloat(trimmed);
          if (!isNaN(amplitude)) {
            const time = Date.now() - startTimeRef.current;
            const newPoint = { time, amplitude };
            
            // Update the ref immediately for the latest data
            // Increase buffer to 500 points for better visibility
            dataPointsRef.current = [...dataPointsRef.current, newPoint].slice(-500);
          }
        }
      }
      
      clearInterval(uiUpdateInterval);
    } catch (err) {
      console.error("Read error:", err);
    } finally {
      setIsStreaming(false);
      readerRef.current = null;
    }
  };

  const stopStreaming = async () => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      setIsStreaming(false);
    }
  };

  const disconnectArduino = async () => {
    await stopStreaming();
    if (portRef.current) {
      await portRef.current.close();
      portRef.current = null;
      setIsConnected(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setResult(null);
    setError(null);

    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(selectedFile);
      setData([]);
    } else if (selectedFile.name.endsWith('.csv')) {
      Papa.parse(selectedFile, {
        header: true,
        dynamicTyping: true,
        complete: (results) => {
          const parsedData = results.data
            .filter((row: any) => row.time !== undefined && row.amplitude !== undefined)
            .map((row: any) => ({
              time: row.time,
              amplitude: row.amplitude
            }));
          setData(parsedData);
          setPreview(null);
        },
        error: (err) => setError("Failed to parse CSV file.")
      });
    } else {
      setError("Unsupported file format. Please upload an image or CSV.");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg'],
      'text/csv': ['.csv']
    },
    multiple: false
  } as any);

  const handleAnalyze = async () => {
    if (data.length === 0 && !preview) {
      setError("No data available for analysis. Please record from Arduino or upload a file.");
      return;
    }
    
    setIsAnalyzing(true);
    setError(null);

    try {
      let analysisInput: any;
      let isImage = false;

      if (preview) {
        isImage = true;
        const base64Data = preview.split(',')[1];
        analysisInput = {
          mimeType: file?.type || 'image/png',
          data: base64Data
        };
      } else {
        // Send a sample of data
        const dataSample = data.slice(-500);
        analysisInput = JSON.stringify(dataSample);
      }

      const analysisResult = await analyzeVibrationSignal(analysisInput, isImage);
      setResult(analysisResult);
    } catch (err) {
      setError("Analysis failed. Please try again.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setData([]);
    setResult(null);
    setError(null);
    if (isStreaming) stopStreaming();
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">FracturePulse <span className="text-indigo-600">AI</span></h1>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full">
              <div className={cn("w-2 h-2 rounded-full animate-pulse", isConnected ? "bg-emerald-500" : "bg-slate-300")} />
              <span className="text-xs">{isConnected ? "Arduino Connected" : "Arduino Disconnected"}</span>
            </div>
          </nav>
          <div className="flex items-center gap-3">
            {!isConnected ? (
              <div className="flex items-center gap-2">
                <a 
                  href={window.location.href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-indigo-600 hover:underline flex items-center gap-1 px-3 py-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  Open in New Tab
                </a>
                <button 
                  onClick={connectArduino}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <Usb className="w-4 h-4" />
                  Connect Arduino
                </button>
              </div>
            ) : (
              <button 
                onClick={disconnectArduino}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <Square className="w-4 h-4 text-red-500" />
                Disconnect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Arduino Controls & Visualization */}
          <div className="lg:col-span-7 space-y-6">
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-600" />
                  Real-time Signal Acquisition
                </h2>
                <div className="flex items-center gap-2">
                  {isConnected && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={isStreaming ? stopStreaming : startStreaming}
                        className={cn(
                          "text-xs font-bold px-4 py-1.5 rounded-full flex items-center gap-2 transition-all",
                          isStreaming 
                            ? "bg-rose-100 text-rose-600 hover:bg-rose-200" 
                            : "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                        )}
                      >
                        {isStreaming ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                        {isStreaming ? "Stop Recording" : "Start Recording"}
                      </button>
                      <button 
                        onClick={disconnectArduino}
                        className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                  {(file || data.length > 0) && (
                    <button 
                      onClick={reset}
                      className="text-xs font-medium text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors px-2"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset
                    </button>
                  )}
                </div>
              </div>
              
              <div className="p-6">
                {!isConnected && !file && data.length === 0 ? (
                  <div className="space-y-6">
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-8 text-center">
                      <Usb className="w-12 h-12 text-indigo-600 mx-auto mb-4" />
                      <h3 className="text-slate-900 font-bold mb-2">Connect your Arduino</h3>
                      <p className="text-slate-600 text-sm mb-6 max-w-md mx-auto">
                        Plug in your Arduino with the I2C vibration sensor (SDA/SCL). Ensure your sketch prints the processed magnitude to <code>Serial.println(value)</code>.
                      </p>
                      <div className="flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-indigo-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase ml-2">Baud Rate:</span>
                          <select 
                            value={baudRate} 
                            onChange={(e) => setBaudRate(Number(e.target.value))}
                            className="bg-transparent border-none text-sm font-bold text-indigo-600 focus:ring-0 cursor-pointer"
                          >
                            <option value={9600}>9600</option>
                            <option value={115200}>115200</option>
                          </select>
                        </div>
                        <button 
                          onClick={connectArduino}
                          className="bg-indigo-600 text-white font-bold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                        >
                          Connect via USB
                        </button>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                      <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-4 text-slate-400 font-bold">Or upload historical data</span></div>
                    </div>

                    <div 
                      {...getRootProps()} 
                      className={cn(
                        "border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
                        isDragActive ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50/50"
                      )}
                    >
                      <input {...getInputProps()} />
                      <Upload className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-500 text-sm">Drop CSV or Image here</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Visualization Area */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden min-h-[400px] flex flex-col items-center justify-center relative">
                      {isStreaming && (
                        <div className="absolute top-4 left-4 z-10 flex flex-col gap-1">
                          <div className="flex items-center gap-2 bg-white/80 backdrop-blur px-3 py-1 rounded-full border border-rose-200">
                            <div className="w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                            <span className="text-[10px] font-black text-rose-600 uppercase tracking-tighter">Live Stream</span>
                          </div>
                          <div className="bg-slate-900/80 backdrop-blur px-3 py-1 rounded-full border border-slate-700 text-[10px] text-white font-mono">
                            RAW: {lastValue}
                          </div>
                        </div>
                      )}
                      
                      {preview ? (
                        <img src={preview} alt="Signal Preview" className="max-h-[400px] w-auto object-contain" referrerPolicy="no-referrer" />
                      ) : data.length > 0 ? (
                        <div className="w-full h-[400px] p-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                              <defs>
                                <linearGradient id="colorAmp" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                              <XAxis 
                                dataKey="time" 
                                label={{ value: 'Time (ms)', position: 'insideBottom', offset: -5, fontSize: 12 }}
                                tick={{ fontSize: 10 }}
                                stroke="#94A3B8"
                                hide={isStreaming} // Hide axis during stream for cleaner look
                              />
                              <YAxis 
                                label={{ value: 'Amplitude', angle: -90, position: 'insideLeft', fontSize: 12 }}
                                tick={{ fontSize: 10 }}
                                stroke="#94A3B8"
                              />
                              <Tooltip 
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                isAnimationActive={false}
                              />
                              <Area 
                                type="monotone" 
                                dataKey="amplitude" 
                                stroke="#4F46E5" 
                                fillOpacity={1} 
                                fill="url(#colorAmp)" 
                                strokeWidth={2}
                                isAnimationActive={!isStreaming}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="text-center p-12">
                          <Activity className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                          <p className="text-slate-400 text-sm">Press "Start Recording" to capture Arduino data</p>
                        </div>
                      )}
                    </div>

                    {data.length > 0 && !isStreaming && !result && !isAnalyzing && (
                      <button 
                        onClick={handleAnalyze}
                        className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                      >
                        <Zap className="w-5 h-5" />
                        Analyze Captured Data
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Info Section */}
            <section className="bg-slate-900 rounded-2xl p-6 text-white overflow-hidden relative">
              <div className="relative z-10">
                <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                  <Info className="w-5 h-5 text-indigo-400" />
                  Arduino Setup Guide
                </h3>
                <div className="space-y-3 text-slate-300 text-sm">
                  <div className="flex gap-3">
                    <div className="bg-slate-800 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-400">1</div>
                    <p>Connect <strong>SDA to A4</strong> and <strong>SCL to A5</strong> on your Arduino.</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="bg-slate-800 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-400">2</div>
                    <p>Connect <strong>VCC to 5V</strong> and <strong>GND to GND</strong>.</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="bg-slate-800 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-400">3</div>
                    <p>Upload a sketch that prints the sensor magnitude followed by a newline. Match the <strong>Baud Rate</strong> in the settings above.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Analysis Results */}
          <div className="lg:col-span-5 space-y-6">
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center"
                >
                  <div className="relative w-20 h-20 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                    <Activity className="absolute inset-0 m-auto w-8 h-8 text-indigo-600 animate-pulse" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Analyzing Signal...</h3>
                  <p className="text-slate-500 text-sm">Our AI is processing frequency patterns and structural damping characteristics.</p>
                </motion.div>
              ) : result ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  {/* Status Card */}
                  <div className={cn(
                    "rounded-2xl p-6 border shadow-sm",
                    result.classification === 'Healthy' 
                      ? "bg-emerald-50 border-emerald-100" 
                      : "bg-rose-50 border-rose-100"
                  )}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className={cn(
                          "text-xs font-bold uppercase tracking-widest mb-1",
                          result.classification === 'Healthy' ? "text-emerald-600" : "text-rose-600"
                        )}>Classification</p>
                        <h3 className={cn(
                          "text-3xl font-black",
                          result.classification === 'Healthy' ? "text-emerald-900" : "text-rose-900"
                        )}>{result.classification}</h3>
                      </div>
                      <div className={cn(
                        "p-3 rounded-2xl",
                        result.classification === 'Healthy' ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                      )}>
                        {result.classification === 'Healthy' ? <CheckCircle2 className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="flex-1 bg-white/50 rounded-xl p-3 border border-white/50">
                        <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Severity</p>
                        <p className={cn(
                          "text-sm font-bold",
                          result.severity === 'None' ? "text-emerald-700" : "text-rose-700"
                        )}>{result.severity}</p>
                      </div>
                      <div className="flex-1 bg-white/50 rounded-xl p-3 border border-white/50">
                        <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Confidence</p>
                        <p className="text-sm font-bold text-slate-900">{(result.confidence * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-semibold text-slate-500 uppercase">Peak Freq</span>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">{result.peakFrequency} <span className="text-sm font-normal text-slate-400">Hz</span></p>
                    </div>
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <Activity className="w-4 h-4 text-indigo-600" />
                        <span className="text-xs font-semibold text-slate-500 uppercase">Signal Quality</span>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">High</p>
                    </div>
                  </div>

                  {/* Reasoning */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-600" />
                        AI Reasoning
                      </h4>
                    </div>
                    <div className="p-5">
                      <p className="text-sm text-slate-600 leading-relaxed italic">
                        "{result.reasoning}"
                      </p>
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-indigo-600" />
                        Recommendations
                      </h4>
                    </div>
                    <div className="p-5 space-y-3">
                      {result.recommendations.map((rec, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div className="mt-1 bg-indigo-50 p-1 rounded">
                            <ChevronRight className="w-3 h-3 text-indigo-600" />
                          </div>
                          <p className="text-sm text-slate-600">{rec}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={reset}
                    className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-5 h-5" />
                    New Analysis
                  </button>
                </motion.div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center border-dashed">
                  <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Activity className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-400 mb-2">Awaiting Signal</h3>
                  <p className="text-slate-400 text-sm">Connect Arduino or upload a signal to see the AI-powered fracture analysis here.</p>
                </div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-rose-500 mt-0.5" />
                <p className="text-sm text-rose-700 font-medium">{error}</p>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <Activity className="w-4 h-4 text-slate-900" />
            <span className="text-sm font-bold tracking-tight">FracturePulse AI</span>
          </div>
          <p className="text-slate-400 text-xs text-center md:text-left">
            &copy; 2026 FracturePulse AI. For research purposes only. Not a substitute for professional medical diagnosis.
          </p>
          <div className="flex items-center gap-6 text-xs font-medium text-slate-400">
            <a href="#" className="hover:text-slate-600 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
