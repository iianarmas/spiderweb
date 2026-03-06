# Spiderweb

A mobile app for generating thread/string art from photos. Upload an image, configure your frame and nail count, and the app computes the optimal nail sequence so you can recreate the image by winding thread around nails on a physical frame.

## Features

- **B&W and color modes** — single-thread greyscale or multi-layer color string art
- **Frame shapes** — circle, square, rectangle with configurable dimensions
- **Step-by-step guide** — follow along nail-by-nail as you build your piece
- **Cloud sync** — projects saved to Supabase; pick up where you left off on any device
- **Auth** — email/password sign-up and login

## Tech stack

- [Expo](https://expo.dev) (SDK 55) + Expo Router
- React Native 0.83 (New Architecture)
- [React Native Skia](https://shopify.github.io/react-native-skia/) — canvas rendering
- [Supabase](https://supabase.com) — auth, database, image storage
- Zustand — client state

## Getting started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- A Supabase project

### Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run `supabase-schema.sql` (keep this file local — it's gitignored)
3. Create a storage bucket named `project-images` (public)
4. Copy your project URL and anon key

### Environment

Create a `.env` file at the project root:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Install and run

```bash
npm install --legacy-peer-deps
npx expo start --clear
```

Press `w` for web, `a` for Android, `i` for iOS.

## Project structure

```
app/
  (auth)/         login, signup screens
  (app)/          main app (project list, new project, project view, guide)
src/
  algorithm/      image processing, string art computation, color decomposition
  components/     NailCircle, ThreadPreview (Skia)
  lib/            supabase client
  store/          Zustand project store
```
