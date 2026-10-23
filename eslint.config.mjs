import {defineConfig} from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  {ignores: ['node_modules/**', 'release/**', 'screenshots/**', 'tests/**', '**/*.mjs']},
  ...obsidianmd.configs.recommended,
  {languageOptions: {parserOptions: {projectService: true}},
    rules: {'obsidianmd/ui/sentence-case': ['warn', {brands: ['The Jobs Application', 'Markdown']}]}
  }
]);
