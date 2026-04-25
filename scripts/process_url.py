# Copyright (c) 2025 Stephen G. Pope
#
# Process URL Tool: Local CLI to run full pipeline from an Instagram link.

import os
import sys
import json
import logging
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline

# Set up logging for the terminal
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("URL_Processor")

def main():
    print("\n--- Viral Content Analyzer: URL Processor ---")
    print("This tool will download a Reel, transcribe it, and extract Viral DNA.")
    
    # Check for API Keys
    missing = []
    if not os.getenv("OPENROUTER_API_KEY"): missing.append("OPENROUTER_API_KEY")
    if not os.getenv("DEEPGRAM_API_KEY"): missing.append("DEEPGRAM_API_KEY")
    if not os.getenv("RAPIDAPI_KEY"): missing.append("RAPIDAPI_KEY")
    
    if missing:
        print(f"\n[!] WARNING: Missing environment variables: {', '.join(missing)}")
        print("Please ensure your .env file is loaded or variables are exported.\n")
        # Optimization for local test: we could try to load .env here if python-dotenv is present
        try:
            from dotenv import load_dotenv
            load_dotenv()
            print("[+] Found .env file, reloading...")
        except ImportError:
            pass

    # Ask for URL if not provided as argument
    if len(sys.argv) > 1:
        reels_url = sys.argv[1]
    else:
        reels_url = input("\nEnter Instagram Reel URL: ").strip()

    if not reels_url:
        print("No URL provided. Exiting.")
        return

    niche = input("Enter Niche (Default: 'Романтические Путешествия'): ").strip() or "Романтические Путешествия"
    target_product = input("Enter Target Product Info (Default: 'Плати по миру'): ").strip() or "Сервис 'Плати по миру' — оплата зарубежных сервисов и бронирований картой РФ"

    job_id = f"cli_test_{os.urandom(2).hex()}"
    
    print(f"\n[+] Starting Pipeline Task ID: {job_id}")
    print("[+] Phase 0 & 1: This may take 30-60 seconds (Downloading + Transcribing + Analyzing)...")
    
    try:
        # We run with analysis_only=True for a quick check, 
        # but user might want the full script, which pipeline does by default in Phase 2
        result = run_content_gen_pipeline(
            job_id=job_id,
            reels_url=reels_url,
            niche=niche,
            target_product_info=target_product,
            analysis_only=False # Let's generate the mirrored scenario too!
        )
        
        print("\n" + "="*50)
        print("   SUCCESS: CONTENT DECONSTRUCTION COMPLETE")
        print("="*50)
        
        # Display Audit Atoms
        audit = result.get("audit", {})
        atoms = audit.get("atoms", {})
        print(f"\n[HOOK ATOM]: {atoms.get('verbal_hook')}")
        print(f"[PSYCHOLOGY]: {atoms.get('psychological_trigger')}")
        
        # Hunt Ladder Display
        ladder = audit.get("hunt_ladder", {})
        print(f"[HUNT LADDER]: {ladder.get('stage', 'N/A')} - {ladder.get('reason', '')}")
        
        print(f"\n[VIRAL DNA]: {audit.get('viral_dna_synthesis')}")
        print(f"[VIRAL SCORE]: {audit.get('viral_score')}/100")
        
        # Display Mirrored Scenario
        scenario = result.get("scenario", {})
        print("\n" + "-"*50)
        print("   MIRRORED SCENARIO (FOR YOUR PRODUCT)")
        print("-"*50)
        print(f"\n[SCENE]: {scenario.get('scene_name')}")
        print(f"\n[SCRIPT]:\n{scenario.get('script')}")
        print(f"\n[PACING]: {scenario.get('pacing_notes')}")
        
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        print(f"\n[!] ERROR: {e}")

if __name__ == "__main__":
    main()
