from flask import Blueprint, jsonify
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline

# Blueprint naming following standard KarPix Toolkit conventions if applicable
v1_automation_content_gen_bp = Blueprint('v1_automation_content_gen', __name__)

@v1_automation_content_gen_bp.route('/v1/automation/content-gen', methods=['POST'])
def content_gen_handler():
    # Basic handler without complex decorators for now since the project is empty
    import uuid
    from flask import request
    data = request.json
    job_id = str(uuid.uuid4())
    
    transcript = data.get("transcript")
    avatar_id = data.get("avatar_id", "469083313936440c9d9651586bd2251a")
    
    result = run_content_gen_pipeline(job_id, transcript, avatar_id)
    
    return jsonify(result), 200
