# Copyright (c) 2025 Stephen G. Pope
#
# Batch Processor for Automated Content Generation
# Scans the database for analyzed content and completes the pipeline for clients with auto-generate enabled.

import time
import logging
from services.v1.database.db_service import get_db_connection, get_client
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def process_pending_automation():
    """
    Finds content that has analysis (audit_json) but no scenario (scenario_json)
    and where the client has auto_generate=True.
    """
    logger.info("Scanning for pending automation tasks...")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Join with clients to check auto_generate setting
        query = """
            SELECT c.job_id, c.client_id, c.audit_json, c.niche, cl.product_info, cl.auto_generate
            FROM processed_content c
            JOIN clients cl ON c.client_id = cl.id
            WHERE c.audit_json IS NOT NULL 
              AND c.scenario_json IS NULL
              AND cl.auto_generate = TRUE
            ORDER BY c.created_at ASC
            LIMIT 5
        """
        cursor.execute(query)
        pending_jobs = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not pending_jobs:
            logger.info("No pending automation tasks found.")
            return
            
        logger.info(f"Found {len(pending_jobs)} tasks to process.")
        
        for job in pending_jobs:
            job_id, client_db_id, audit_json, niche, product_info, auto_gen = job
            content_id = f"auto_{job_id}"
            
            logger.info(f"Processing Job {job_id} for Client {client_db_id}")
            
            try:
                # We skip Phase 0 & 1 by passing the audit_json directly? 
                # Actually run_content_gen_pipeline expects transcript or reels_url.
                # So we might need a way to resume from audit.
                # OR we just pass a dummy transcript and rely on the fact that Phase 1 
                # will just re-run (harmless if deterministic, but redundant).
                # To be efficient, let's just re-run the pipeline with the original transcript.
                
                # Fetch transcript
                conn = get_db_connection()
                curr = conn.cursor()
                curr.execute("SELECT transcript, reels_url FROM processed_content WHERE job_id = %s", (job_id,))
                row = curr.fetchone()
                curr.close()
                conn.close()
                
                if row:
                    transcript, reels_url = row
                    run_content_gen_pipeline(
                        job_id=job_id, # Reuse original job_id to update same record
                        transcript=transcript,
                        reels_url=reels_url,
                        niche=niche,
                        target_product_info=product_info,
                        client_id=client_db_id,
                        manual=False
                    )
                    logger.info(f"Successfully completed automation for Job {job_id}")
                
            except Exception as e:
                logger.error(f"Failed to process job {job_id}: {e}")
                
    except Exception as e:
        logger.error(f"Error in batch processor: {e}")

if __name__ == "__main__":
    while True:
        process_pending_automation()
        time.sleep(60) # Run every minute
