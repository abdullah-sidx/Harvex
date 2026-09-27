def sub(path, subs):
    s = open(path, encoding='utf-8').read()
    for old, new in subs:
        if old not in s:
            print('MISS:', path, '|', old[:60])
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8', newline='').write(s)
    print('ok:', path)

sub('server.ts', [
    ('const __dirname = path.dirname(__filename);',
     'const _unusedDirname = path.dirname(__filename); void _unusedDirname;'),
    ('const FRONTEND_ORIGIN = process.env.VITE_BACKEND_URL || "http://localhost:8000";',
     ''),
    ('mimeType = "image/jpeg", cropType = "Unknown", language = "en"',
     'mimeType = "image/jpeg", cropType: _cropType = "Unknown", language = "en"'),
    ('const { message, language = "en", farmContext } = req.body;',
     'const { message, language = "en", farmContext: _farmContext } = req.body; void _farmContext;'),
])

sub('src/App.tsx', [
    ("import React, { useState, useEffect } from 'react';",
     "import { useState, useEffect } from 'react';"),
])

sub('src/components/OnboardingModal.tsx', [
    ("import { TRANSLATIONS, INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';",
     "import { INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';"),
])

sub('src/components/SettingsModal.tsx', [
    ("import { TRANSLATIONS, INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';",
     "import { INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';"),
])

sub('src/components/ChatView.tsx', [
    ('const t = TRANSLATIONS[language];', 'const _t = TRANSLATIONS[language]; void _t;'),
])

sub('src/components/WeatherModal.tsx', [
    ('const t = TRANSLATIONS[language];', 'const _t = TRANSLATIONS[language]; void _t;'),
])
