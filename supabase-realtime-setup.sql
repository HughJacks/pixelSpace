-- Enable Realtime for the drawings table
-- Run this in Supabase Dashboard → SQL Editor
-- This adds the drawings table to the supabase_realtime publication so INSERT events are broadcast to subscribed clients

ALTER PUBLICATION supabase_realtime ADD TABLE public.drawings;
