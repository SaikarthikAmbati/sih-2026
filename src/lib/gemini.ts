import { supabase } from './supabase';

const functionUrl = process.env.EXPO_PUBLIC_GEMINI_FUNCTION_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export async function requestGeminiInsight(prompt: string): Promise<string> {
  if (!functionUrl || !supabaseAnonKey || !supabase) {
    throw new Error('Gemini is not configured. Set the Supabase environment variables and EXPO_PUBLIC_GEMINI_FUNCTION_URL.');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Sign in before requesting a Gemini insight.');
  }

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}).`);
  }

  const body = (await response.json()) as { text?: string };
  if (!body.text) {
    throw new Error('Gemini returned no insight text.');
  }
  return body.text;
}
