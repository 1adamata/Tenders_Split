// file: src/App.jsx

import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { categorizeWithGemini } from './utils/openai';
import {
  UploadCloud,
  FileText,
  Download,
  List,
  ChevronsRight,
} from 'lucide-react';

// Основной компонент приложения
export default function ExcelCategorizer() {
  // Управление состоянием
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headers, setHeaders] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState('');
  const [categorizedData, setCategorizedData] = useState([]);
  const [originalSheetData, setOriginalSheetData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    regions: [],
    categories: [],
  });

  // Мемоизация цветовой схемы для категорий
  const categoryColors = useMemo(
    () => ({
      айти: '#d1fae5',
      телеком: '#cffafe',
      'инф.структура': '#fef9c3',
      прочее: '#fee2e2',
    }),
    [],
  );
  
  // Функция для генерации примера файла
  const generateSample = () => {
    const sampleData = [
      { Компания: 'TechSoft', Регион: 'Москва', Описание: 'Разработка ИИ', Категория: 'айти' },
      { Компания: 'Telecom Plus', Регион: 'Нью-Йорк', Описание: 'Сети 5G', Категория: 'телеком' },
      { Компания: 'DataSecure', Регион: 'Берлин', Описание: 'Кибербезопасность', Категория: 'инф.структура'},
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Пример');
    XLSX.writeFile(wb, 'gemini-categorizer-шаблон.xlsx');
  };

  // --- Основная логика ---

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
        const wb = XLSX.read(bstr, { type: 'binary' });
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setSelectedSheet(wb.SheetNames[0] || '');
        if (wb.SheetNames[0]) {
          extractHeaders(wb, wb.SheetNames[0]);
        }
      } catch (err) {
        console.error('Ошибка чтения файла:', err);
        setError('❌ Не удалось прочитать файл Excel.');
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
    setSelectedColumn('');
  };

  const startCategorization = async () => {
    if (!workbook || !selectedSheet || !selectedColumn) {
      setError('Пожалуйста, сначала выберите лист и столбец.');
      return;
    }

    setIsLoading(true);
    setError('');

    const ws = workbook.Sheets[selectedSheet];
    const jsonData = XLSX.utils.sheet_to_json(ws);
    setOriginalSheetData(jsonData);

    const dataToCategorize = jsonData
      .map((row, index) => ({
        id: index + 1,
        value: row[selectedColumn],
      }))
      .filter((item) => item.value != null && String(item.value).trim() !== '');

    if (dataToCategorize.length === 0) {
      setError(
        `⚠️ В выбранном столбце ("${selectedColumn}") не найдено данных.`,
      );
      setIsLoading(false);
      return;
    }

    await processInChunks(dataToCategorize);
    setIsLoading(false);
  };

  const processInChunks = async (data) => {
    const chunkArray = (array, size) =>
      Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
        array.slice(i * size, i * size + size),
      );
    const chunks = chunkArray(data, 150);
    setProgress({ current: 0, total: chunks.length });

    let allResults = [];
    for (let i = 0; i < chunks.length; i++) {
      setProgress({ current: i + 1, total: chunks.length });
      if (!(await processSingleChunk(chunks[i], allResults, i))) {
        break;
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
        return true;
      } catch (err) {
        console.error(
          `Ошибка в части ${chunkIndex + 1}, попытка ${attempt}:`,
          err,
        );
        if (attempt === retries) {
          setError(
            `❌ Ошибка обработки части ${chunkIndex + 1} после ${retries} попыток.`,
          );
          return false;
        }
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }
  };

 const exportToExcel = () => {
    if (!workbook || !originalSheetData.length) return;

    const originalWs = workbook.Sheets[selectedSheet];
    const categoryMap = new Map(categorizedData.map(item => [item.id, item.category]));
    
    let filteredData = originalSheetData.map((row, index) => ({
      ...row,
      'Категория': categoryMap.get(index + 1) || ''
    }));

    if (filters.regions.length > 0) {
      const regionColumn = headers.find(h => 
        ['регион', 'region', 'город', 'city'].some(term => 
          h.toLowerCase().includes(term)
        )
      );
      
      if (regionColumn) {
        filteredData = filteredData.filter(row => 
          filters.regions.includes(row[regionColumn])
        );
      }
    }

    if (filters.categories.length > 0) {
      filteredData = filteredData.filter(row => 
        filters.categories.includes(row['Категория'])
      );
    }

    const newWs = XLSX.utils.json_to_sheet(filteredData);
    
    ['!cols', '!rows', '!merges'].forEach(prop => {
      if (originalWs[prop]) newWs[prop] = originalWs[prop];
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, newWs, "Отфильтрованные_данные");
    XLSX.writeFile(wb, `отфильтрованный_${fileName}`);
  };

  const resetState = () => {
    setFileName('');
    setWorkbook(null);
    setSheetNames([]);
    setSelectedSheet('');
    setHeaders([]);
    setSelectedColumn('');
    setCategorizedData([]);
    setOriginalSheetData([]);
    setError('');
    setProgress({ current: 0, total: 0 });
    document.getElementById('file-upload-input').value = '';
  };

  // --- UI Компоненты ---

  const renderFileUpload = () => (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>1. Загрузите ваш файл</h2>
      <p style={styles.cardSubtitle}>
        Выберите файл Excel (.xlsx или .xls), чтобы начать.
      </p>
      <label htmlFor="file-upload-input" style={styles.uploadLabel}>
        <UploadCloud size={20} />
        <span>Выберите файл</span>
      </label>
      <input
        id="file-upload-input"
        type="file"
        accept=".xlsx, .xls"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
    </div>
  );

  const renderConfiguration = () => (
    <div style={styles.card}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 style={styles.cardTitle}>2. Настройте категоризацию</h2>
        <button onClick={resetState} style={styles.changeFileButton}>
          Выбрать другой файл
        </button>
      </div>
      <p style={styles.cardSubtitle}>
        <FileText
          size={16}
          style={{ verticalAlign: 'bottom', marginRight: '8px' }}
        />
        Файл: <strong>{fileName}</strong>
      </p>

      <div style={styles.configGrid}>
        <div style={styles.formGroup}>
          <label style={styles.formLabel} htmlFor="sheet-select">
            <List size={16} /> Выберите лист
          </label>
          <select
            id="sheet-select"
            value={selectedSheet}
            onChange={handleSheetChange}
            style={styles.select}
          >
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.formLabel} htmlFor="column-select">
            <ChevronsRight size={16} /> Выберите столбец для категоризации
          </label>
          <select
            id="column-select"
            value={selectedColumn}
            onChange={(e) => setSelectedColumn(e.target.value)}
            style={styles.select}
            disabled={!selectedSheet}
          >
            <option value="">-- Выберите столбец --</option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={startCategorization}
        style={styles.ctaButton}
        disabled={!selectedColumn || isLoading}
      >
        {isLoading ? 'Обработка...' : 'Начать категоризацию'}
      </button>
    </div>
  );

  const renderProgress = () => (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Обработка...</h2>
      <p style={styles.loadingText}>
        ⏳ Анализирую часть {progress.current} из {progress.total}
      </p>
      <div style={styles.progressBarContainer}>
        <div
          style={{
            ...styles.progressBar,
            width: `${(progress.current / progress.total) * 100}%`,
          }}
        ></div>
      </div>
    </div>
  );

  const renderResults = () => {
    const categoryCounts = categorizedData.reduce((acc, item) => {
      const cat = item.category || 'Неизвестно';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {});

    const uniqueRegions = Array.from(
      new Set(
        originalSheetData
          .map((row) => {
            const regionKey = Object.keys(row).find((key) =>
              ['регион', 'region', 'город', 'city'].some((term) =>
                key.toLowerCase().includes(term),
              ),
            );
            return regionKey ? row[regionKey] : null;
          })
          .filter(Boolean),
      ),
    );

    return (
      <div style={styles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={styles.cardTitle}>3. Результаты</h2>
          <button onClick={exportToExcel} style={styles.downloadButton}>
            <Download size={16} />
            Скачать результаты
          </button>
        </div>

        <div style={styles.filterSection}>
          <h3 style={styles.filterTitle}>Фильтровать перед скачиванием:</h3>

          {headers.some((header) =>
            ['регион', 'region', 'город', 'city'].some((term) =>
              header.toLowerCase().includes(term),
            ),
          ) && (
            <div style={styles.filterGroup}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px'}}>
                <label style={styles.filterLabel}>Регионы:</label>
                <div>
                  <button onClick={() => setFilters(f => ({ ...f, regions: uniqueRegions }))} style={styles.filterActionButton}>Выбрать все</button>
                  <button onClick={() => setFilters(f => ({ ...f, regions: [] }))} style={styles.filterActionButton}>Сбросить</button>
                </div>
              </div>
              <select
                multiple
                value={filters.regions}
                style={styles.filterSelect}
                onChange={(e) => {
                  const selectedValues = Array.from(e.target.selectedOptions, (opt) => opt.value);
                  setFilters({ ...filters, regions: selectedValues });
                }}
              >
                {uniqueRegions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={styles.filterGroup}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px'}}>
              <label style={styles.filterLabel}>Категории:</label>
              <div>
                <button onClick={() => setFilters(f => ({ ...f, categories: Object.keys(categoryColors) }))} style={styles.filterActionButton}>Выбрать все</button>
                <button onClick={() => setFilters(f => ({ ...f, categories: [] }))} style={styles.filterActionButton}>Сбросить</button>
              </div>
            </div>
            <select
              multiple
              value={filters.categories}
              style={{...styles.filterSelect, minHeight: '100px'}}
              onChange={(e) => {
                  const selectedValues = Array.from(e.target.selectedOptions, (opt) => opt.value);
                  setFilters({ ...filters, categories: selectedValues });
              }}
            >
              {Object.keys(categoryColors).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '10px',
            }}
          >
            <button
              onClick={() => setFilters({ regions: [], categories: [] })}
              style={styles.resetFilterButton}
            >
              Сбросить все фильтры
            </button>

            {(filters.regions?.length > 0 ||
              filters.categories?.length > 0) && (
              <div style={styles.filterInfo}>
                <span style={styles.filterInfoText}>
                  Выбрано:
                  {filters.regions?.length > 0 && (
                    <span style={styles.filterInfoItem}>
                      {filters.regions.length} регион(ов)
                    </span>
                  )}
                  {filters.categories?.length > 0 && (
                    <span style={styles.filterInfoItem}>
                      {filters.categories.length} категория(ий)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={styles.enhancementsSection}>
          <div style={styles.enhancementItem}>
            <button onClick={generateSample} style={styles.sampleButton}>
              <FileText size={16} style={{ marginRight: '8px' }} />
              Скачать шаблон
            </button>
          </div>

          <div style={styles.enhancementItem}>
            <div style={styles.statsBox}>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Всего строк:</span>
                <span style={styles.statValue}>
                  {categorizedData.length}
                  <span style={styles.statSubtext}>
                    {' '}
                    (из {originalSheetData.length})
                  </span>
                </span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Категорий:</span>
                <span style={styles.statValue}>
                  {Object.keys(categoryCounts).length}
                </span>
              </div>
            </div>
          </div>

          <div style={styles.enhancementItem}>
            <div style={styles.quickFilters}>
              <span style={styles.quickFiltersLabel}>Быстрые фильтры:</span>
              {Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([category, count]) => (
                  <button
                    key={category}
                    onClick={() =>
                      setFilters({ ...filters, categories: [category] })
                    }
                    style={{
                      ...styles.quickFilterButton,
                      backgroundColor:
                        categoryColors[category.toLowerCase()] || '#e2e8f0',
                    }}
                  >
                    {category} ({count})
                  </button>
                ))}
            </div>
          </div>
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Значение</th>
                <th style={styles.th}>Категория</th>
              </tr>
            </thead>
            <tbody>
              {categorizedData.map((item) => (
                <tr key={item.id}>
                  <td style={styles.td}>{item.id}</td>
                  <td style={styles.td}>{item.value}</td>
                  <td
                    style={{
                      ...styles.td,
                      backgroundColor:
                        categoryColors[item.category?.toLowerCase()] ||
                        '#f3f4f6',
                    }}
                  >
                    <strong>{item.category || '—'}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>📊 Категоризатор Excel с Gemini AI</h1>
      </header>
      <main style={styles.main}>
        {error && <div style={styles.errorBox}>{error}</div>}

        {!workbook && !isLoading && renderFileUpload()}
        {workbook &&
          !isLoading &&
          categorizedData.length === 0 &&
          renderConfiguration()}
        {isLoading && renderProgress()}
        {categorizedData.length > 0 && !isLoading && renderResults()}
      </main>
    </div>
  );
}

// --- Стили ---

const styles = {
  container: {
    background: '#f3f4f6',
    minHeight: '100vh',
    fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
  },
  header: {
    padding: '1.5rem',
    background: 'white',
    borderBottom: '1px solid #e5e7eb',
    textAlign: 'center',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#111827',
    margin: 0,
  },
  main: { maxWidth: '1000px', margin: '2rem auto', padding: '0 1rem' },
  card: {
    background: 'white',
    borderRadius: '12px',
    padding: '2rem',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
    marginBottom: '1rem',
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 0.5rem 0',
  },
  cardSubtitle: {
    fontSize: '0.9rem',
    color: '#6b7280',
    margin: '0 0 1.5rem 0',
  },
  uploadLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.5rem',
    background: '#3b82f6',
    color: 'white',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s',
  },
  configGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1.5rem',
    margin: '2rem 0',
  },
  formGroup: { display: 'flex', flexDirection: 'column' },
  formLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem',
  },
  select: {
    padding: '0.75rem',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    fontSize: '1rem',
  },
  ctaButton: {
    width: '100%',
    padding: '0.8rem',
    background: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    ':disabled': { background: '#d1d5db', cursor: 'not-allowed' },
  },
  changeFileButton: {
    background: 'transparent',
    border: '1px solid #d1d5db',
    color: '#374151',
    padding: '0.4rem 0.8rem',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  loadingText: {
    textAlign: 'center',
    fontSize: '1.1rem',
    color: '#4b5563',
    margin: '2rem 0',
  },
  progressBarContainer: {
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: '#3b82f6',
    transition: 'width 0.3s',
  },
  downloadButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#22c55e',
    color: 'white',
    border: 'none',
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500',
  },
  tableContainer: {
    maxHeight: '500px',
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    position: 'sticky',
    top: 0,
    background: '#f9fafb',
    padding: '0.75rem',
    textAlign: 'left',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: '600',
    color: '#374151',
  },
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #e5e7eb',
    color: '#374151',
  },
  errorBox: {
    margin: '0 0 1rem 0',
    padding: '1rem',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '8px',
  },
  filterSection: {
    margin: '20px 0',
    padding: '20px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    backgroundColor: '#f8fafc',
  },
  filterTitle: {
    margin: '0 0 15px 0',
    fontSize: '16px',
    color: '#334155',
    fontWeight: '600',
  },
  filterGroup: {
    margin: '0 0 15px 0',
  },
  filterLabel: {
    display: 'block',
    marginBottom: '6px',
    fontWeight: '500',
    fontSize: '14px',
    color: '#475569',
  },
  filterSelect: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    backgroundColor: 'white',
    minHeight: '220px', // <-- Увеличена высота
    fontSize: '14px',
  },
  resetFilterButton: {
    padding: '6px 12px',
    background: '#f1f5f9',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#475569',
  },
  filterActionButton: {
    background: 'transparent',
    border: 'none',
    color: '#3b82f6',
    cursor: 'pointer',
    fontSize: '13px',
    marginLeft: '10px',
    padding: '2px 4px',
    fontWeight: '500',
  },
  filterInfo: {
    fontSize: '14px',
    color: '#64748b',
  },
  filterInfoText: {
    display: 'flex',
    gap: '10px',
  },
  filterInfoItem: {
    padding: '2px 8px',
    backgroundColor: '#e2e8f0',
    borderRadius: '4px',
    marginLeft: '5px',
  },
   enhancementsSection: {
    margin: '25px 0',
    padding: '20px',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0'
  },
  enhancementItem: {
    marginBottom: '20px',
    '&:last-child': {
      marginBottom: 0
    }
  },
  sampleButton: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#ecfdf5',
    border: '1px solid #a7f3d0',
    color: '#064e3b',
    borderRadius: '8px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      backgroundColor: '#d1fae5'
    }
  },
  statsBox: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    padding: '15px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  statLabel: {
    fontSize: '13px',
    color: '#64748b',
    marginBottom: '4px'
  },
  statValue: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b'
  },
  statSubtext: {
    fontSize: '12px',
    color: '#94a3b8',
    fontWeight: 'normal'
  },
  quickFilters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center'
  },
  quickFiltersLabel: {
    fontSize: '14px',
    color: '#64748b',
    marginRight: '8px'
  },
  quickFilterButton: {
    padding: '6px 12px',
    borderRadius: '20px',
    border: 'none',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      opacity: 0.8,
      transform: 'translateY(-1px)'
    }
  }
};
