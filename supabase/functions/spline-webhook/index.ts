import { createClient } from 'npm:@supabase/supabase-js@2';
// Standard CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    // Initialize Supabase client using environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set!');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Parse the incoming JSON payload from the request
    const rawPayload = await req.json();
    console.log('Received Spline webhook with raw payload:', rawPayload);
    
    // Extract actual data from rich text format if needed
    let payload: any = {};
    let user_id: string | null = null;
    
    // Check if payload is in rich text format (array with children)
    if (Array.isArray(rawPayload) && rawPayload[0]?.children?.[0]?.text) {
      console.log('Detected rich text format, extracting JSON...');
      try {
        const jsonString = rawPayload[0].children[0].text;
        payload = JSON.parse(jsonString);
        console.log('Extracted payload from rich text:', payload);
      } catch (e) {
        console.warn('Failed to parse JSON from rich text, using default');
        payload = { number: 1 }; // Default to goals
      }
    } else if (typeof rawPayload === 'object' && rawPayload !== null) {
      // Normal JSON format
      payload = rawPayload;
      console.log('Using normal payload format');
    } else {
      console.warn('Unknown payload format, using default');
      payload = { number: 1 }; // Default to goals
    }
    
    // Extract user_id from payload or try to get from headers/context
    user_id = payload.user_id || null;
    console.log('Extracted user_id:', user_id);
    
    // --- Logic to determine which modal to show ---
    let eventName = 'show_modal_default';
    let modalType = 'goals'; // Default to 'goals'
    let message = '人生目标设定';
    if (payload.number === 1 || payload.action === 'goals') {
      modalType = 'goals';
      eventName = 'show_goals_modal';
      message = '是时候设定你的人生目标了。';
      console.log('Decision: Trigger "goals" modal.');
    } else if (payload.number === 2 || payload.action === 'welcome') {
      modalType = 'welcome';
      eventName = 'show_welcome_modal';
      message = '欢迎来到这个世界！';
      console.log('Decision: Trigger "welcome" modal.');
    } else {
      console.log('Decision: No specific rule matched, falling back to default "goals" modal.');
    }
    // --- Triggering mechanism from the WORKING code ---
    // Instead of broadcasting, we insert a record into the 'frontend_events' table.
    // The frontend should be listening for inserts on this table.
    const eventData = {
      message: message,
      modalType: modalType,
      timestamp: new Date().toISOString(),
      source: 'spline-webhook',
      originalPayload: payload
    };
    console.log(`Inserting event '${eventName}' into 'frontend_events' table.`);
    const { data, error } = await supabase.from('frontend_events') // This must be the table your frontend is listening to!
    .insert({
      event_name: eventName,
      event_data: eventData,
      user_id: user_id // Include extracted user_id
    }).select();
    // Handle potential errors during insertion
    if (error) {
      console.error('Error inserting event into Supabase:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Event inserted successfully:', data);
    // Return a success response back to Spline
    return new Response(JSON.stringify({
      success: true,
      message: 'Event triggered successfully in the frontend.',
      triggeredEvent: {
        eventName,
        modalType
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    // Catch any other errors (e.g., JSON parsing)
    console.error('An unexpected error occurred in the Edge Function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal Server Error',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
