'use client';

import React, { useState, useRef } from 'react';
import { Upload, X, FileSpreadsheet, Download, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { customerService } from '@/services/customerService';

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkUploadModal({ isOpen, onClose, onSuccess }: BulkUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replaceAll, setReplaceAll] = useState<boolean>(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadResult, setUploadResult] = useState<{
    total_processed: number;
    inserted_count: number;
    updated_count: number;
    deleted_count: number;
    errors: string[];
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadResult(null);
      setErrorMessage(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setUploadResult(null);
      setErrorMessage(null);
    }
  };

  const handleDownloadSampleCSV = () => {
    const csvContent = [
      'consumer_no,consumer_name,meter_id,dtc_code,latitude,longitude,pending_amount,days_pending',
      '0441001001,Rajesh Kumar,MTR89901,0441001,21.1458,79.0882,4500,45',
      '0441001002,Pooja Sharma,MTR89902,0441002,21.1390,79.0720,1850,15',
      '0441001003,Anil Deshmukh,MTR89903,0441001,21.1245,79.0680,8900,60',
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_customers_import.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setErrorMessage(null);

    try {
      const res = await customerService.uploadCustomers(selectedFile, replaceAll);
      setUploadResult(res);
      window.dispatchEvent(new Event('customers-updated'));
      onSuccess();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Failed to upload customer data file.';
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const resetModal = () => {
    setSelectedFile(null);
    setUploadResult(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Bulk Import Customers</h3>
              <p className="text-xs text-slate-500">Upload CSV or Excel (.xlsx) files to seed customer records</p>
            </div>
          </div>
          <button
            onClick={() => {
              resetModal();
              onClose();
            }}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Download Sample Banner */}
          <div className="bg-blue-50/80 border border-blue-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-blue-900">Need a sample file template?</p>
                <p className="text-xs text-blue-700 font-medium">Supported CSV / Excel column headers:</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[
                    'consumer_no',
                    'consumer_name',
                    'meter_id',
                    'dtc_code',
                    'latitude',
                    'longitude',
                    'pending_amount',
                    'days_pending',
                  ].map((h) => (
                    <span
                      key={h}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-100 border border-blue-200 text-[11px] font-mono font-semibold text-blue-800"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={handleDownloadSampleCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors shrink-0 self-start cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download Template
              </button>
            </div>
            <p className="text-[10px] text-blue-600 font-medium">
              Optional columns: address, area
            </p>
          </div>

          {/* Database Replace Mode Toggle */}
          {!uploadResult && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={replaceAll}
                  onChange={(e) => setReplaceAll(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800">Replace all old data</span>
                  <span className="text-[11px] text-slate-500 block">
                    {replaceAll
                      ? 'Wipes existing customer & meter records before importing the new file.'
                      : 'Keep existing records and update matching consumer IDs (additive import).'}
                  </span>
                </div>
              </label>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${
                replaceAll ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-200 text-slate-600'
              }`}>
                {replaceAll ? 'Replace Mode' : 'Append Mode'}
              </span>
            </div>
          )}

          {/* Upload Drop Zone */}
          {!uploadResult && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                selectedFile
                  ? 'border-blue-500 bg-blue-50/30'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>

              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB • Click or drag to replace</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">Drag & drop your CSV or Excel file here</p>
                  <p className="text-xs text-slate-500">Supports .csv, .xlsx files up to 10MB</p>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 p-3.5 rounded-lg text-xs text-red-700 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <p className="font-semibold">Import Failed</p>
                <p className="text-red-600">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Upload Success Results */}
          {uploadResult && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 text-green-800 font-bold text-sm">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Import Completed Successfully!
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                  <div className="bg-white border border-green-200 p-2.5 rounded-md">
                    <div className="text-lg font-extrabold text-slate-900">{uploadResult.total_processed}</div>
                    <div className="text-[11px] text-slate-500 font-medium uppercase">Processed</div>
                  </div>
                  <div className="bg-white border border-green-200 p-2.5 rounded-md">
                    <div className="text-lg font-extrabold text-green-600">{uploadResult.inserted_count}</div>
                    <div className="text-[11px] text-slate-500 font-medium uppercase">New Customers</div>
                  </div>
                  <div className="bg-white border border-green-200 p-2.5 rounded-md">
                    <div className="text-lg font-extrabold text-blue-600">
                      {uploadResult.deleted_count > 0 ? uploadResult.deleted_count : uploadResult.updated_count}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium uppercase">
                      {uploadResult.deleted_count > 0 ? 'Replaced Old' : 'Updated Existing'}
                    </div>
                  </div>
                </div>
              </div>

              {uploadResult.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  <p className="font-semibold text-amber-900">Skipped Rows / Warnings:</p>
                  {uploadResult.errors.map((err, i) => (
                    <p key={i} className="text-amber-800 font-mono text-[11px]">• {err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          {uploadResult ? (
            <button
              onClick={resetModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Upload Another File
            </button>
          ) : (
            <div></div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                resetModal();
                onClose();
              }}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-md transition-colors"
            >
              {uploadResult ? 'Done' : 'Cancel'}
            </button>

            {!uploadResult && (
              <button
                onClick={handleUploadSubmit}
                disabled={!selectedFile || isUploading}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-md shadow-xs transition-colors"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Importing Data...
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    Upload & Import
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
