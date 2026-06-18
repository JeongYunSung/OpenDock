import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { SortMode } from "./data";

interface PaginationGuardOptions {
  catalogPage: number;
  catalogPageCount: number;
  catalogPageSize: number;
  detailKey: string;
  myDocksPage: number;
  myDocksPageCount: number;
  searchQuery: string;
  setCatalogPage: Dispatch<SetStateAction<number>>;
  setDetailVersion: (value: string) => void;
  setMyDocksPage: Dispatch<SetStateAction<number>>;
  setVersionPage: Dispatch<SetStateAction<number>>;
  setVersionTotal: Dispatch<SetStateAction<number>>;
  sortMode: SortMode;
  versionPage: number;
  versionPageCount: number;
  versionPageSize: number;
}

export function usePaginationGuards(options: PaginationGuardOptions): void {
  useEffect(() => {
    options.setCatalogPage(1);
  }, [options.searchQuery, options.sortMode, options.catalogPageSize, options.setCatalogPage]);

  useEffect(() => {
    options.setVersionPage(1);
    options.setVersionTotal(0);
  }, [options.detailKey, options.versionPageSize, options.setVersionPage, options.setVersionTotal]);

  useEffect(() => {
    if (options.catalogPage > options.catalogPageCount) {
      options.setCatalogPage(options.catalogPageCount);
    }
  }, [options.catalogPage, options.catalogPageCount, options.setCatalogPage]);

  useEffect(() => {
    if (options.versionPage > options.versionPageCount) {
      options.setVersionPage(options.versionPageCount);
    }
  }, [options.versionPage, options.versionPageCount, options.setVersionPage]);

  useEffect(() => {
    if (options.myDocksPage > options.myDocksPageCount) {
      options.setMyDocksPage(options.myDocksPageCount);
    }
  }, [options.myDocksPage, options.myDocksPageCount, options.setMyDocksPage]);

  useEffect(() => {
    options.setDetailVersion("");
  }, [options.detailKey, options.setDetailVersion]);
}
