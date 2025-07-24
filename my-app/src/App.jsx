// file: src/App.jsx

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { categorizeWithGemini } from "./utils/openai";
import { UploadCloud, FileText, Download, List, ChevronsRight } from 'lucide-react';

// Main App Component
export default function ExcelCategorizer() {
  // State Management
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headers, setHeaders] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState("");
  const [categorizedData, setCategorizedData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");

  // Memoize color mapping for performance
  const categoryColors = useMemo(() => ({
    айти: "#d1fae5",
    телеком: "#cffafe",
    "инф.структура": "#fef9c3",
    прочее: "#fee2e2",
  }), []);

  // --- Core Logic ---

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    resetState();
    setFileName(file.name);
    setIsLoading(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setSelectedSheet(wb.SheetNames[0] || "");
        if (wb.SheetNames[0]) {
          extractHeaders(wb, wb.SheetNames[0]);
        }
      } catch (err) {
        console.error("File reading error:", err);
        setError("❌ Failed to read the Excel file.");
      }
      setIsLoading(false);
    };
    reader.readAsBinaryString(file);
  };

  const extractHeaders = (wb, sheetName) => {
    const ws = wb.Sheets[sheetName];
    const firstRow = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0];
    setHeaders(firstRow || []);
  };
  
  const handleSheetChange = (e) => {
    const newSheet = e.target.value;
    setSelectedSheet(newSheet);
    extractHeaders(workbook, newSheet);
    setSelectedColumn("");
  };

  const startCategorization = async () => {
    if (!workbook || !selectedSheet || !selectedColumn) {
      setError("Please select a sheet and a column first.");
      return;
    }

    setIsLoading(true);
    setError("");
    
    const ws = workbook.Sheets[selectedSheet];
    const jsonData = XLSX.utils.sheet_to_json(ws);
    const columnIndex = headers.indexOf(selectedColumn);

    const dataToCategorize = jsonData
      .map((row, index) => ({
        id: index + 1,
        value: row[selectedColumn]
      }))
      .filter(item => item.value != null && String(item.value).trim() !== "");

    if (dataToCategorize.length === 0) {
      setError(`⚠️ No data found in the selected column ("${selectedColumn}").`);
      setIsLoading(false);
      return;
    }
    
    await processInChunks(dataToCategorize);
    setIsLoading(false);
  };
  
  const processInChunks = async (data) => {
    const chunkArray = (array, size) => Array.from({ length: Math.ceil(array.length / size) }, (_, i) => array.slice(i * size, i * size + size));
    const chunks = chunkArray(data, 150);
    setProgress({ current: 0, total: chunks.length });

    let allResults = [];
    for (let i = 0; i < chunks.length; i++) {
      setProgress({ current: i + 1, total: chunks.length });
      if (!(await processSingleChunk(chunks[i], allResults, i))) {
        break; // Stop if a chunk fails
      }
    }
    setProgress({ current: 0, total: 0 });
  };
  
  const processSingleChunk = async (chunk, allResults, chunkIndex) => {
    let retries = 3, delay = 2000;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await categorizeWithGemini(chunk);
        if (Array.isArray(response)) {
          allResults.push(...response);
          setCategorizedData([...allResults]);
        }
        return true; // Success
      } catch (err) {
        console.error(`Error on chunk ${chunkIndex + 1}, attempt ${attempt}:`, err);
        if (attempt === retries) {
          setError(`❌ Chunk ${chunkIndex + 1} failed after ${retries} attempts.`);
          return false; // Failure
        }
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(categorizedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Categorized_Data");
    XLSX.writeFile(wb, `categorized_${fileName}.xlsx`);
  };

  const resetState = () => {
    setFileName("");
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet("");
    setHeaders([]);
    setSelectedColumn("");
    setCategorizedData([]);
    setError("");
    setProgress({ current: 0, total: 0 });
    // Reset file input
    document.getElementById('file-upload-input').value = "";
  };


  // --- UI Components ---

  const renderFileUpload = () => (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>1. Upload Your File</h2>
      <p style={styles.cardSubtitle}>Select an Excel file (.xlsx or .xls) to begin.</p>
      <label htmlFor="file-upload-input" style={styles.uploadLabel}>
        <UploadCloud size={20} />
        <span>Choose a File</span>
      </label>
      <input id="file-upload-input" type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: "none" }} />
    </div>
  );

  const renderConfiguration = () => (
    <div style={styles.card}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <h2 style={styles.cardTitle}>2. Configure Categorization</h2>
        <button onClick={resetState} style={styles.changeFileButton}>Change File</button>
      </div>
      <p style={styles.cardSubtitle}>
        <FileText size={16} style={{verticalAlign: 'bottom', marginRight: '8px'}} />
        File: <strong>{fileName}</strong>
      </p>

      <div style={styles.configGrid}>
        {/* Sheet Selector */}
        <div style={styles.formGroup}>
          <label style={styles.formLabel} htmlFor="sheet-select">
            <List size={16} /> Select Sheet
          </label>
          <select id="sheet-select" value={selectedSheet} onChange={handleSheetChange} style={styles.select}>
            {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        {/* Column Selector */}
        <div style={styles.formGroup}>
          <label style={styles.formLabel} htmlFor="column-select">
            <ChevronsRight size={16} /> Select Column to Categorize
          </label>
          <select id="column-select" value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)} style={styles.select} disabled={!selectedSheet}>
            <option value="">-- Choose a column --</option>
            {headers.map(header => <option key={header} value={header}>{header}</option>)}
          </select>
        </div>
      </div>

      <button onClick={startCategorization} style={styles.ctaButton} disabled={!selectedColumn || isLoading}>
        {isLoading ? 'Processing...' : 'Start Categorization'}
      </button>
    </div>
  );

  const renderProgress = () => (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Processing...</h2>
      <p style={styles.loadingText}>
        ⏳ Analyzing chunk {progress.current} of {progress.total}
      </p>
      <div style={styles.progressBarContainer}>
        <div style={{ ...styles.progressBar, width: `${(progress.current / progress.total) * 100}%` }}></div>
      </div>
    </div>
  );
  
  const renderResults = () => (
    <div style={styles.card}>
       <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
          <h2 style={styles.cardTitle}>3. Results</h2>
          <button onClick={exportToExcel} style={styles.downloadButton}>
            <Download size={16} />
            Download Results
          </button>
      </div>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Value</th>
              <th style={styles.th}>Category</th>
            </tr>
          </thead>
          <tbody>
            {categorizedData.map((item, index) => (
              <tr key={item.id || index}>
                <td style={styles.td}>{item.id}</td>
                <td style={styles.td}>{item.value}</td>
                <td style={{ ...styles.td, backgroundColor: categoryColors[item.category?.toLowerCase()] || "#f3f4f6" }}>
                  <strong>{item.category || "—"}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>📊 Gemini AI Excel Categorizer</h1>
      </header>
      <main style={styles.main}>
        {error && <div style={styles.errorBox}>{error}</div>}
        
        {!workbook && !isLoading && renderFileUpload()}
        {workbook && !isLoading && categorizedData.length === 0 && renderConfiguration()}
        {isLoading && renderProgress()}
        {categorizedData.length > 0 && !isLoading && renderResults()}
      </main>
    </div>
  );
}

// --- Styles ---

const styles = {
  container: { background: "#f3f4f6", minHeight: "100vh", fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif" },
  header: { padding: "1.5rem", background: 'white', borderBottom: '1px solid #e5e7eb', textAlign: 'center' },
  title: { fontSize: "1.75rem", fontWeight: "bold", color: "#111827", margin: 0 },
  main: { maxWidth: "1000px", margin: "2rem auto", padding: "0 1rem" },
  card: { background: "white", borderRadius: "12px", padding: "2rem", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)", marginBottom: '1rem' },
  cardTitle: { fontSize: "1.25rem", fontWeight: "600", color: "#1f2937", margin: '0 0 0.5rem 0' },
  cardSubtitle: { fontSize: "0.9rem", color: "#6b7280", margin: '0 0 1.5rem 0' },
  uploadLabel: { display: "flex", alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: "0.75rem 1.5rem", background: "#3b82f6", color: "white", borderRadius: "8px", cursor: "pointer", fontWeight: '500', transition: 'background-color 0.2s' },
  configGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', margin: '2rem 0' },
  formGroup: { display: 'flex', flexDirection: 'column' },
  formLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' },
  select: { padding: '0.75rem', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '1rem' },
  ctaButton: { width: '100%', padding: '0.8rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s', ':disabled': { background: '#d1d5db', cursor: 'not-allowed' } },
  changeFileButton: { background: 'transparent', border: '1px solid #d1d5db', color: '#374151', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer' },
  loadingText: { textAlign: "center", fontSize: "1.1rem", color: '#4b5563', margin: '2rem 0' },
  progressBarContainer: { height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' },
  progressBar: { height: '100%', background: '#3b82f6', transition: 'width 0.3s' },
  downloadButton: { display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#22c55e', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: '500' },
  tableContainer: { maxHeight: '500px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { position: 'sticky', top: 0, background: "#f9fafb", padding: "0.75rem", textAlign: "left", borderBottom: "1px solid #e5e7eb", fontWeight: '600', color: '#374151' },
  td: { padding: "0.75rem", borderBottom: "1px solid #e5e7eb", color: '#374151' },
  errorBox: { margin: "0 0 1rem 0", padding: "1rem", background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: "8px" },
};