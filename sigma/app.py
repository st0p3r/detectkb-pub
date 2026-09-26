"""DetectKB Sigma conversion service.

Converts Sigma rules to SIEM queries with pySigma. The DetectKB backend calls
this service; it is not meant to be exposed publicly.
"""
from typing import Callable, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sigma.backends.elasticsearch import EqlBackend, LuceneBackend
from sigma.backends.kusto import KustoBackend
from sigma.backends.splunk import SplunkBackend
from sigma.collection import SigmaCollection
from sigma.exceptions import SigmaError
from sigma.pipelines.elasticsearch import ecs_windows
from sigma.pipelines.microsoftxdr import microsoft_xdr_pipeline
from sigma.pipelines.sentinelasim import sentinel_asim_pipeline
from sigma.pipelines.splunk import splunk_windows_pipeline
from sigma.processing.pipeline import ProcessingPipeline


class Target(BaseModel):
    id: str
    label: str
    language: str


TARGETS = {
    "splunk": (Target(id="splunk", label="Splunk", language="SPL"), SplunkBackend, splunk_windows_pipeline),
    "kusto_xdr": (Target(id="kusto_xdr", label="Microsoft Defender XDR", language="KQL"), KustoBackend, microsoft_xdr_pipeline),
    "kusto_sentinel": (Target(id="kusto_sentinel", label="Microsoft Sentinel (ASIM)", language="KQL"), KustoBackend, sentinel_asim_pipeline),
    "eql": (Target(id="eql", label="Elastic (ECS)", language="EQL"), EqlBackend, ecs_windows),
    "lucene": (Target(id="lucene", label="Elastic (ECS)", language="Lucene"), LuceneBackend, ecs_windows),
}

app = FastAPI(title="DetectKB Sigma service")


class ConvertRequest(BaseModel):
    rule: str
    target: str


class ConvertResponse(BaseModel):
    target: Target
    queries: List[str]
    pipelineApplied: bool


def _convert(rule: str, backend_cls, pipeline: Callable[[], ProcessingPipeline] | None) -> List[str]:
    backend = backend_cls(processing_pipeline=pipeline()) if pipeline else backend_cls()
    return [str(q) for q in backend.convert(SigmaCollection.from_yaml(rule))]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/targets", response_model=List[Target])
def targets():
    return [t for t, _, _ in TARGETS.values()]


@app.post("/convert", response_model=ConvertResponse)
def convert(req: ConvertRequest):
    if req.target not in TARGETS:
        raise HTTPException(status_code=400, detail=f"Unknown target '{req.target}'")
    target, backend_cls, pipeline = TARGETS[req.target]
    try:
        try:
            return ConvertResponse(target=target, queries=_convert(req.rule, backend_cls, pipeline), pipelineApplied=True)
        except SigmaError:
            # The field-mapping pipelines only know Windows log sources; fall back
            # to the backend's raw field names for everything else.
            return ConvertResponse(target=target, queries=_convert(req.rule, backend_cls, None), pipelineApplied=False)
    except SigmaError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:  # malformed YAML and similar
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")
