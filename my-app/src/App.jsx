import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx-js-style';
import { categorizeWithGemini } from './utils/openai';
import {
  UploadCloud,
  FileText,
  Download,
  List,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

// 🔧  Утилита: приведение строки к единому виду для сравнения
const normalize = (s) => (s ?? '').toString().trim().toLowerCase();

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
  const [minCosts, setMinCosts] = useState({}); // { normalizedCategory: value }
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });
  const [modalData, setModalData] = useState(null);
  const [cellHyperlinks, setCellHyperlinks] = useState({}); // Store hyperlinks by cell address

  // Мемоизация цветовой схемы для категорий
  const categoryColors = useMemo(
    () => ({
      'айти': '#d1fae5',
      'телеком': '#cffafe',
      'инф.структура': '#fef9c3',
      'строительство/ремонт': '#fef08a',
      'оборудование': '#e5e7eb',
      'по/лицензии': '#ccfbf1',
      'транспорт/логистика': '#fed7aa',
      'канцтовары/хозтовары': '#fbcfe8',
      'одежда/сиз': '#dbeafe',
      'услуги (прочее)': '#e9d5ff',
      'прочее': '#fee2e2',
    }),
    [],
  );

  // После мемоизации categoryColors добавьте описания категорий
  const categoryDescriptions = useMemo(
    () => ({
      'айти': 'Информационные технологии: разработка ПО, системная интеграция, техническая поддержка, облачные решения, кибербезопасность',
      'телеком': 'Телекоммуникации: услуги связи, интернет-провайдинг, мобильная связь, спутниковая связь, IP-телефония',
      'инф.структура': 'Информационная инфраструктура: серверное оборудование, сетевое оборудование, системы хранения данных, ЦОДы',
      'строительство/ремонт': 'Строительные работы и ремонт: капитальное строительство, ремонтные работы, отделочные материалы, строительные услуги',
      'оборудование': 'Различное оборудование: промышленное, медицинское, офисное, технологическое оборудование и техника',
      'по/лицензии': 'Программное обеспечение и лицензии: покупка лицензий, подписки на ПО, обновления программ, антивирусы',
      'транспорт/логистика': 'Транспортные услуги и логистика: грузоперевозки, пассажирские перевозки, складские услуги, курьерская доставка',
      'канцтовары/хозтовары': 'Канцелярские и хозяйственные товары: офисные принадлежности, бумага, моющие средства, хозяйственный инвентарь',
      'одежда/сиз': 'Одежда и средства индивидуальной защиты: спецодежда, защитная экипировка, униформа, обувь',
      'услуги (прочее)': 'Прочие услуги: консалтинг, юридические услуги, бухгалтерские услуги, маркетинг, обучение персонала',
      'прочее': 'Прочие товары и услуги: товары, не попадающие в другие категории, разные виды работ и поставок'
    }),
    [],
  );

  // Состояние для управления tooltip
  const [tooltipVisible, setTooltipVisible] = useState(null);

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
        // Read with all options to preserve hyperlinks
        const wb = XLSX.read(bstr, { 
          type: 'binary',
          cellHTML: true,
          cellText: true,
          cellStyles: true,
          cellFormulas: true,
          cellDates: true,
          cellNF: true,
          sheetStubs: true,
          bookVBA: true
        });
        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setSelectedSheet(wb.SheetNames[0] || '');
        if (wb.SheetNames[0]) {
          extractHeaders(wb, wb.SheetNames[0]);
          extractHyperlinks(wb, wb.SheetNames[0]);
          // Автоматически устанавливаем столбец "Название"
          autoSelectNazvanieColumn(wb, wb.SheetNames[0]);
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

  // Новая функция для автоматического выбора столбца "Название"
  const autoSelectNazvanieColumn = (wb, sheetName) => {
    const ws = wb.Sheets[sheetName];
    const firstRow = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || [];
    
    // Ищем столбец "Название" (с учетом регистра и пробелов)
    const nazvanieColumn = firstRow.find(header => 
      normalize(header) === 'название'
    );
    
    if (nazvanieColumn) {
      setSelectedColumn(nazvanieColumn);
    } else {
      setError('❌ В файле не найден столбец "Название". Убедитесь, что такой столбец существует.');
    }
  };

  // Extract all hyperlinks from the worksheet
  const extractHyperlinks = (wb, sheetName) => {
    const ws = wb.Sheets[sheetName];
    const hyperlinks = {};
    
    // Iterate through all cells
    Object.keys(ws).forEach(address => {
      if (address[0] !== '!') { // Skip metadata
        const cell = ws[address];
        // Check for hyperlink in cell
        if (cell.l && cell.l.Target) {
          hyperlinks[address] = cell.l.Target;
        }
        // Also check for HYPERLINK formula
        if (cell.f && cell.f.toLowerCase().includes('hyperlink')) {
          // Extract URL from HYPERLINK formula
          const match = cell.f.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
          if (match) {
            hyperlinks[address] = match[1];
          }
        }
      }
    });
    
    setCellHyperlinks(hyperlinks);
    console.log(`Extracted ${Object.keys(hyperlinks).length} hyperlinks from ${sheetName}`);
  };

  const handleSheetChange = (e) => {
    const newSheet = e.target.value;
    setSelectedSheet(newSheet);
    extractHeaders(workbook, newSheet);
    extractHyperlinks(workbook, newSheet);
    // Автоматически устанавливаем столбец "Название" при смене листа
    autoSelectNazvanieColumn(workbook, newSheet);
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
      .map((row, index) => ({ id: index + 1, value: row[selectedColumn] }))
      .filter((item) => item.value != null && String(item.value).trim() !== '');

    if (dataToCategorize.length === 0) {
      setError(`⚠️ В выбранном столбце ("${selectedColumn}") не найдено данных.`);
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
    const chunks = chunkArray(data, 100);
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
    let retries = 3,
      delay = 2000;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await categorizeWithGemini(chunk);
        if (Array.isArray(response)) {
          const mapped = response.map((res, idx) => ({
            id: chunk[idx].id,
            category: res.category?.trim() || ''
          }));
          allResults.push(...mapped);
          setCategorizedData([...allResults]);
        }
        return true;
      } catch (err) {
        console.error(`Ошибка в части ${chunkIndex + 1}, попытка ${attempt}:`, err);
        if (attempt === retries) {
          setError(`❌ Ошибка обработки части ${chunkIndex + 1} после ${retries} попыток.`);
          return false;
        }
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }
  };

  const dataWithCategories = useMemo(() => {
    if (categorizedData.length === 0) return [];
    const categoryMap = new Map(categorizedData.map(item => [item.id, item.category]));
    return originalSheetData.map((row, index) => ({
      ...row,
      id: index + 1,
      Категория: categoryMap.get(index + 1) || '',
    }));
  }, [categorizedData, originalSheetData]);

  // Get hyperlink for a specific row and column
  const getHyperlinkForCell = (rowIndex, columnName) => {
    const colIndex = headers.indexOf(columnName);
    if (colIndex === -1) return null;
    
    const colLetter = XLSX.utils.encode_col(colIndex);
    const cellAddress = colLetter + (rowIndex + 2); // +2 because row 1 is headers, and Excel is 1-indexed
    
    return cellHyperlinks[cellAddress] || null;
  };

  const displayedData = useMemo(() => {
    const findHeader = (aliases) => headers.find(h => aliases.some(alias => normalize(h) === alias));
    
    const columnNames = {
      cost: findHeader(['стоимость']),
      region: findHeader(['регион']),
      adNumber: findHeader(['№ объявления']),
      lotNumber: findHeader(['№ лота']),
      method: findHeader(['способ проведения']),
      source: findHeader(['источник']),
      status: findHeader(['статус']),
    };

    let filteredData = dataWithCategories;

    if (filters.regions.length > 0 && columnNames.region) {
      filteredData = filteredData.filter((row) => filters.regions.includes(row[columnNames.region]));
    }

    if (filters.categories.length > 0) {
      const normalizedSelectedCats = filters.categories.map(normalize);
      filteredData = filteredData.filter((row) => {
        const rowCategory = normalize(row['Категория']);
        if (!normalizedSelectedCats.includes(rowCategory)) return false;

        const minCostForCategory = minCosts[rowCategory];
        if (minCostForCategory && columnNames.cost) {
          const costValue = row[columnNames.cost];
          if (costValue === null || costValue === undefined) return false;
          const cost = parseFloat(String(costValue).replace(/[^0-9.-]+/g, ''));
          const minCost = parseFloat(minCostForCategory);
          if (isNaN(cost) || isNaN(minCost)) return false;
          return cost >= minCost;
        }
        return true;
      });
    }
    
    let mappedData = filteredData.map(row => {
      // Get hyperlink for the selected column
      const link = getHyperlinkForCell(row.id - 1, selectedColumn);
      
      return {
        id: row.id,
        value: row[selectedColumn],
        link: link,
        category: row['Категория'],
        cost: columnNames.cost ? row[columnNames.cost] : undefined,
        region: columnNames.region ? row[columnNames.region] : undefined,
        adNumber: columnNames.adNumber ? row[columnNames.adNumber] : undefined,
        lotNumber: columnNames.lotNumber ? row[columnNames.lotNumber] : undefined,
        method: columnNames.method ? row[columnNames.method] : undefined,
        source: columnNames.source ? row[columnNames.source] : undefined,
        status: columnNames.status ? row[columnNames.status] : undefined,
      };
    });

    if (sortConfig.key) {
      mappedData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        
        if (sortConfig.key === 'cost') {
          aValue = parseFloat(String(aValue).replace(/[^0-9.-]+/g, '')) || 0;
          bValue = parseFloat(String(bValue).replace(/[^0-9.-]+/g, '')) || 0;
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }

    return mappedData;
  }, [dataWithCategories, filters, minCosts, headers, selectedColumn, sortConfig, cellHyperlinks]);

  const exportToExcel = () => {
    if (!workbook || !originalSheetData.length) return;

    let filteredData = dataWithCategories;

    // Apply filters
    if (filters.regions.length > 0) {
      const regionColumn = headers.find(h => normalize(h).includes('регион'));
      if (regionColumn) {
        filteredData = filteredData.filter(row =>
          filters.regions.includes(row[regionColumn])
        );
      }
    }

    if (filters.categories.length > 0) {
      const costColumn = headers.find(h => normalize(h) === 'стоимость');
      const normalizedSelectedCats = filters.categories.map(normalize);

      filteredData = filteredData.filter(row => {
        const rowCategory = normalize(row['Категория']);
        if (!normalizedSelectedCats.includes(rowCategory)) return false;

        const minCostForCategory = minCosts[rowCategory];
        if (minCostForCategory && costColumn) {
          const cost = parseFloat(String(row[costColumn]).replace(/[^0-9.-]+/g, ''));
          return !isNaN(cost) && cost >= parseFloat(minCostForCategory);
        }
        return true;
      });
    }

    // Create new worksheet
    const dataForExport = filteredData.map(({ id, ...rest }) => rest);
    const newWs = XLSX.utils.json_to_sheet(dataForExport);

    // Copy hyperlinks from original worksheet
    const wsOrig = workbook.Sheets[selectedSheet];
    
    // Iterate through all columns to preserve hyperlinks
    headers.forEach((header, colIndex) => {
      const colLetter = XLSX.utils.encode_col(colIndex);
      
      filteredData.forEach((row, rowIndex) => {
        const origRowNum = row.id + 1; // Excel row in original sheet (1-based)
        const origCellAddress = colLetter + origRowNum;
        const newCellAddress = colLetter + (rowIndex + 2); // New row in export (1-based, +1 for header)
        
        // Get original cell
        const origCell = wsOrig[origCellAddress];
        
        // If original cell has hyperlink, copy it to new cell
        if (origCell && origCell.l && origCell.l.Target) {
          if (!newWs[newCellAddress]) {
            newWs[newCellAddress] = { t: 's', v: row[header] || '' };
          }
          newWs[newCellAddress].l = { Target: origCell.l.Target };
          
          // If there's tooltip text, preserve it
          if (origCell.l.Tooltip) {
            newWs[newCellAddress].l.Tooltip = origCell.l.Tooltip;
          }
        }
        
        // Also check for HYPERLINK formulas
        if (origCell && origCell.f && origCell.f.toLowerCase().includes('hyperlink')) {
          if (!newWs[newCellAddress]) {
            newWs[newCellAddress] = { t: 's', v: row[header] || '' };
          }
          // Copy the formula
          newWs[newCellAddress].f = origCell.f;
        }
      });
    });

    // Set column widths (2.5 cm ≈ 94 px)
    const cmToPx = cm => Math.round(cm * 37.7952755906);
    const colWidthPx = cmToPx(2.5);
    newWs['!cols'] = Array.from(
      { length: headers.length },
      () => ({ wpx: colWidthPx })
    );

    // Apply text wrapping to all cells
    Object.keys(newWs).forEach(addr => {
      if (addr[0] === '!') return;
      const cell = newWs[addr];
      cell.s = {
        ...(cell.s || {}),
        alignment: { 
          wrapText: true,
          horizontal: 'center',
          vertical: 'center' 
        }
      };
    });

    // Copy merges if they exist
    const originalWs = workbook.Sheets[selectedSheet];
    if (originalWs['!merges']) {
      newWs['!merges'] = originalWs['!merges'];
    }

    // Create and save workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, newWs, 'Отфильтрованные_данные');
    
    // Use write with bookType to ensure hyperlinks are preserved
    XLSX.writeFile(wb, `отфильтрованный_${fileName}`, { 
      bookType: 'xlsx',
      bookSST: true,
      type: 'binary'
    });
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
    setMinCosts({});
    setFilters({ regions: [], categories: [] });
    setSortConfig({ key: null, direction: 'ascending' });
    setModalData(null);
    setCellHyperlinks({});
    if (document.getElementById('file-upload-input')) {
        document.getElementById('file-upload-input').value = '';
    }
  };
  
  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown size={14} style={{ opacity: 0.5, marginLeft: '4px' }} />;
    }
    if (sortConfig.direction === 'ascending') {
      return <ArrowUp size={14} style={{ marginLeft: '4px' }} />;
    }
    return <ArrowDown size={14} style={{ marginLeft: '4px' }} />;
  };

  // Handlers for modal
  const handleRowClick = (item) => {
    setModalData(item);
  };

  const closeModal = () => {
    setModalData(null);
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
          <label style={styles.formLabel}>
            <ChevronsRight size={16} /> Столбец для категоризации
          </label>
          <div style={styles.selectedColumnDisplay}>
            {selectedColumn ? (
              <span style={styles.selectedColumnText}>
              ✓ {selectedColumn}
              </span>
            ) : (
              <span style={styles.noColumnText}>
              ❌ Столбец "Название" не найден
              </span>
            )}
          </div>
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
              normalize(key).includes('регион'),
            );
            return regionKey ? row[regionKey] : null;
          })
          .filter(Boolean),
      ),
    );
    
    const findHeader = (aliases) => headers.find(h => aliases.some(alias => normalize(h) === alias)) || aliases[0];
    
    const columnNames = {
      cost: findHeader(['стоимость']),
      region: findHeader(['регион']),
      adNumber: findHeader(['№ объявления']),
      lotNumber: findHeader(['№ лота']),
      method: findHeader(['способ проведения']),
      source: findHeader(['источник']),
      status: findHeader(['статус']),
    };

    const handleMinCostChange = (category, value) => {
      setMinCosts((prev) => ({ ...prev, [normalize(category)]: value }));
    };

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

          {columnNames.region && (
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

          {columnNames.cost && filters.categories.length > 0 && (
            <div style={styles.costFiltersContainer}>
                <h4 style={styles.filterLabel}>Минимальная стоимость (для столбца "{columnNames.cost}"):</h4>
                {filters.categories.map(category => (
                    <div key={category} style={styles.costFilterItem}>
                        <label style={styles.costFilterLabel}>{category}:</label>
                        <input
                            type="number"
                            value={minCosts[normalize(category)] || ''}
                            onChange={(e) => handleMinCostChange(category, e.target.value)}
                            placeholder="Введите число"
                            style={styles.costInput}
                        />
                    </div>
                ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '10px',
            }}
          >
            <button
              onClick={() => {
                setFilters({ regions: [], categories: [] });
                setMinCosts({});
              }}
              style={styles.resetFilterButton}
              disabled={!filters.regions?.length && !filters.categories?.length && Object.keys(minCosts).length === 0}
            >
              Сбросить все фильтры
            </button>

            {(filters.regions?.length > 0 || filters.categories?.length > 0 || Object.keys(minCosts).some(k => minCosts[k])) && (
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
                  {Object.keys(minCosts).filter(k => minCosts[k]).length > 0 && (
                    <span style={styles.filterInfoItem}>
                      {Object.keys(minCosts).filter(k => minCosts[k]).length} фильтр(ов) по стоимости
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={styles.enhancementsSection}>
          <div style={styles.enhancementItem}>
            <div style={styles.statsBox}>
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Всего строк:</span>
                <span style={styles.statValue}>
                  {displayedData.length}
                  <span style={styles.statSubtext}>
                    {' '}
                    (из {categorizedData.length})
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
                  <div key={category} style={styles.quickFilterWrapper}>
                    <button
                      onClick={() =>
                        setFilters({ ...filters, categories: [normalize(category)] })
                      }
                      onMouseEnter={() => setTooltipVisible(category)}
                      onMouseLeave={() => setTooltipVisible(null)}
                      style={{
                        ...styles.quickFilterButton,
                        backgroundColor:
                          categoryColors[normalize(category)] || '#e2e8f0',
                      }}
                    >
                      {category} ({count})
                    </button>
                    {tooltipVisible === category && (
                      <div style={styles.tooltip}>
                        {categoryDescriptions[normalize(category)] || 'Описание недоступно'}
                      </div>
                    )}
                  </div>
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
                {columnNames.cost && <th style={styles.thSortable} onClick={() => requestSort('cost')}>{columnNames.cost}{getSortIcon('cost')}</th>}
                {columnNames.region && <th style={styles.th}>{columnNames.region}</th>}
                {columnNames.adNumber && <th style={styles.th}>{columnNames.adNumber}</th>}
                {columnNames.lotNumber && <th style={styles.th}>{columnNames.lotNumber}</th>}
                {columnNames.method && <th style={styles.th}>{columnNames.method}</th>}
                {columnNames.source && <th style={styles.th}>{columnNames.source}</th>}
                {columnNames.status && <th style={styles.th}>{columnNames.status}</th>}
              </tr>
            </thead>
            <tbody>
              {displayedData.map((item) => (
                <tr key={item.id} onClick={() => handleRowClick(item)} style={styles.trClickable}>
                  <td style={styles.td}>{item.id}</td>
                  <td style={styles.td}>{item.value}</td>
                  <td
                    style={{
                      ...styles.td,
                      backgroundColor:
                        categoryColors[normalize(item.category)] ||
                        '#f3f4f6',
                    }}
                  >
                    <strong>{item.category || '—'}</strong>
                  </td>
                  {columnNames.cost && <td style={styles.td}>{item.cost}</td>}
                  {columnNames.region && <td style={styles.td}>{item.region}</td>}
                  {columnNames.adNumber && <td style={styles.td}>{item.adNumber}</td>}
                  {columnNames.lotNumber && <td style={styles.td}>{item.lotNumber}</td>}
                  {columnNames.method && <td style={styles.td}>{item.method}</td>}
                  {columnNames.source && <td style={styles.td}>{item.source}</td>}
                  {columnNames.status && <td style={styles.td}>{item.status}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Modal window component
  const renderModal = () => {
    if (!modalData) return null;

    const findHeader = (aliases) => headers.find(h => aliases.some(alias => normalize(h) === alias)) || aliases[0];
    
    const displayTitles = {
        value: selectedColumn || 'Значение',
        category: 'Категория',
        cost: findHeader(['стоимость']),
        region: findHeader(['регион']),
        adNumber: findHeader(['№ объявления']),
        lotNumber: findHeader(['№ лота']),
        method: findHeader(['способ проведения']),
        source: findHeader(['источник']),
        status: findHeader(['статус']),
    };

    return (
        <div style={styles.modalOverlay} onClick={closeModal}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>Детали строки ID: {modalData.id}</h3>
                    <button style={styles.modalCloseButton} onClick={closeModal}>&times;</button>
                </div>
                <div style={styles.modalBody}>
                    {Object.entries(modalData).map(([key, value]) => {
                      if (key === 'id' || key === 'link' || value === undefined) return null;

                      const title = displayTitles[key] || key;

                      return (
                        <div key={key} style={styles.modalDetailRow}>
                          <strong style={styles.modalDetailKey}>{title}:</strong>
                          <span style={styles.modalDetailValue}>
                            {/* Display value as hyperlink if we have a link */}
                            {key === 'value' && modalData.link ? (
                              <a href={modalData.link} target="_blank" rel="noopener noreferrer" style={styles.modalLink}>
                                {value}
                              </a>
                            ) : (
                              value
                            )}
                          </span>
                        </div>
                      );
                    })}
                </div>
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
        {renderModal()}
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
  main: { maxWidth: '1200px', margin: '2rem auto', padding: '0 1rem' }, // Increased width
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
    maxHeight: '600px', // Increased height
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
  },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' },
  th: {
    position: 'sticky',
    top: 0,
    background: '#f9fafb',
    padding: '0.75rem',
    textAlign: 'left',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: '600',
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  thSortable: {
    position: 'sticky',
    top: 0,
    background: '#f9fafb',
    padding: '0.75rem',
    textAlign: 'left',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #e5e7eb',
    color: '#374151',
    fontSize: '0.9rem',
  },
  trClickable: {
    cursor: 'pointer',
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
    minHeight: '150px',
    fontSize: '14px',
  },
  costFiltersContainer: { // <-- Контейнер для фильтров по стоимости
    marginTop: '15px',
    borderTop: '1px solid #e2e8f0',
    paddingTop: '15px'
  },
  costFilterItem: { // <-- Стиль для одного фильтра по стоимости
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '10px',
    alignItems: 'center',
    marginBottom: '8px'
  },
  costFilterLabel: {
    fontWeight: '500',
    fontSize: '14px',
    color: '#475569',
    textAlign: 'right'
  },
  costInput: { 
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box',
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
    flexWrap: 'wrap',
    gap: '10px',
  },
  filterInfoItem: {
    padding: '2px 8px',
    backgroundColor: '#e2e8f0',
    borderRadius: '4px',
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
  },
  quickFilterWrapper: {
    position: 'relative',
    display: 'inline-block'
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#1f2937',
    color: 'white',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.4',
    maxWidth: '300px',
    minWidth: '250px',
    whiteSpace: 'normal',
    textAlign: 'center',
    zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    marginBottom: '8px',
    // Стрелочка снизу
    '::after': {
      content: '""',
      position: 'absolute',
      top: '100%',
      left: '50%',
      marginLeft: '-6px',
      borderWidth: '6px',
      borderStyle: 'solid',
      borderColor: '#1f2937 transparent transparent transparent'
    }
  },

  // ✅ FIX: Styles for modal
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    background: 'white',
    padding: '2rem',
    borderRadius: '12px',
    boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '1rem',
    marginBottom: '1rem',
  },
  modalTitle: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1f2937',
  },
  modalCloseButton: {
    background: 'transparent',
    border: 'none',
    fontSize: '2rem',
    fontWeight: 'bold',
    lineHeight: 1,
    color: '#6b7280',
    cursor: 'pointer',
  },
  modalBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  modalDetailRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '1rem',
    padding: '0.5rem 0',
    borderBottom: '1px solid #f3f4f6',
  },
  modalDetailKey: {
    fontWeight: '600',
    color: '#4b5563',
    textAlign: 'right',
  },
  modalDetailValue: {
    color: '#111827',
    wordBreak: 'break-word',
  }
};
