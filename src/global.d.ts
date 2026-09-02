// @juce-framework/webview が既に window.__JUCE__ の型をグローバル宣言しているため、
// ここでは追加のグローバル宣言を行わない。
// Vite 固有の型 (?worker&inline 等) を解決するために vite/client を参照する。
/// <reference types="vite/client" />

export { };